import * as Supabase from '@supabase/supabase-js';
import SpotifyWebAPI from 'spotify-web-api-node';

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const runtimeConfig = useRuntimeConfig();
    const { name: user } = query;
    const SpotifyAPI = new SpotifyWebAPI({
        clientId: runtimeConfig.SPOTIFY_CLIENT_ID,
        clientSecret: runtimeConfig.SPOTIFY_CLIENT_SECRET,
        redirectUri: runtimeConfig.SPOTIFY_REDIRECT_URI,
    });
    const supabase = Supabase.createClient(
        runtimeConfig.SUPABASE_URL!,
        runtimeConfig.SUPABASE_KEY!
    );
    const { data: userRows, error: userError } = await supabase.from('spotify').select('*');
    if (userError || !userRows) throw createError({
        status: 404,
        statusMessage: 'Not Found',
    })
    const spotifyUser = userRows.find(row => row.user === user);
    if (!spotifyUser) throw createError({
        status: 500,
        statusMessage: 'Internal Server Error',
    })
    const { access, refresh } = spotifyUser;
    SpotifyAPI.setAccessToken(access);
    SpotifyAPI.setRefreshToken(refresh);
    const { body: { access_token: newAccess, refresh_token: newRefresh } } = await SpotifyAPI.refreshAccessToken();
    SpotifyAPI.setAccessToken(newAccess);
    SpotifyAPI.setRefreshToken(newRefresh!);
    await supabase.from('spotify').update({ access: newAccess, refresh: newRefresh }).eq('user', user);
    const res = {
        next: {}
    };
    const MainSpotifyRes = await SpotifyAPI.getMyCurrentPlaybackState({ market: 'US' })
        .catch(() => res.next = {
            status: 200,
            body: {
                isPlaying: false,
                playing: {
                    track: {
                        title: 'Nothing playing',
                        url: null,
                    },
                    album: {
                        title: 'Nothing playing',
                        artists: [],
                        image: null,
                    },
                    artists: [],
                    meta: {
                        progress: {
                            start: 0,
                            end: 0,
                            current: 0,
                            percentage: 0,
                        },
                    },
                },
            },
        });
    if (res.next) return res.next;
    const { body } = MainSpotifyRes;
    if (!new Object(body).hasOwnProperty('item')) return {
            isPlaying: false,
            playing: {
                track: {
                    title: 'Nothing playing',
                    url: null,
                },
                album: {
                    title: 'Nothing playing',
                    artists: [],
                    image: null,
                },
                artists: [],
                meta: {
                    progress: {
                        start: 0,
                        end: 0,
                        current: 0,
                        percentage: 0,
                    },
                },
            },
    };
    /** @type {SpotifyAPI.TrackObjectFull} */
    // @ts-ignore
    const item = body.item;
    const { name, album, artists, external_urls: externalURLs } = item;
    const data = {
        track: {
            title: name,
            url: externalURLs.spotify,
        },
        album: {
            title: album.name,
            artists: [],
            image: album.images.find((sDat: Record<string, any>) => sDat.width === 64e1).url || 'https://via.placeholder.com/64',
        },
        artists: [],
        meta: {
            progress: {
                start: Date.now() - body!.progress_ms,
                end: Date.now() + (body.item.duration_ms - body.progress_ms),
                current: body.progress_ms,
                percentage: (body.progress_ms / body.item.duration_ms) * 1e2,
            },
        },
    };
    for (const artist of artists) {
        data.artists.push(
            await SpotifyAPI.getArtist(artist.id)
                .then(
                    dat => ({
                        name: dat.body.name,
                        image: dat.body.images.find(({ width }) => width === 64e1)?.url || 'https://via.placeholder.com/64',
                        url: dat.body.external_urls.spotify,
                    }),
                    () => ({
                        name: artist.name,
                        image: 'https://via.placeholder.com/64',
                        url: 'https://open.spotify.com',
                    }),
                ),
        );
    }
    for (const albumArtist of album.artists) {
        data.album.artists.push(
            await SpotifyAPI.getArtist(albumArtist.id)
                .then(
                    dat => ({
                        name: dat.body.name,
                        image: dat.body.images.find(({ width }) => width === 64e1)?.url || 'https://via.placeholder.com/64',
                        url: dat.body.external_urls.spotify,
                    }),
                    () => ({
                        name: albumArtist.name,
                        image: 'https://via.placeholder.com/64',
                        url: 'https://open.spotify.com',
                    }),
                ),
        );
    }
    return {
        isPlaying: true,
        playing: data,
    }
});