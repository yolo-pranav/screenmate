// YouTube refuses to play embedded videos when the request carries no Referer
// ("Error 153: Video player configuration error"). Pages served from the
// custom app://- protocol never send one, so the trailer player would always
// fail on desktop. Give YouTube embed requests the app's public origin as the
// Referer instead (requests that already have one are left alone).
const EMBED_REFERER = "https://screenmate.guptapranav0144.workers.dev/";

const YOUTUBE_URLS = [
    "https://www.youtube-nocookie.com/*",
    "https://www.youtube.com/*",
];

function allowYouTubeEmbeds(session) {
    session.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_URLS }, (details, callback) => {
        const headers = details.requestHeaders;
        if (!headers.Referer && !headers.referer) headers.Referer = EMBED_REFERER;
        callback({ requestHeaders: headers });
    });
}

module.exports = { allowYouTubeEmbeds };
