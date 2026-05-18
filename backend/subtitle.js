// Subtitle utilities: SRT to WebVTT conversion + proxying remote subtitle files.
//
// Browsers can only render WebVTT via the <track> element, so any SRT subtitle
// from a provider has to be transcoded on the fly. We do this in the proxy
// layer so the frontend always receives `text/vtt`.

// Convert SubRip (.srt) text to WebVTT (.vtt) text.
//
// SRT example:
//   1
//   00:00:01,234 --> 00:00:04,567
//   Hello world
//
// VTT example:
//   WEBVTT
//
//   00:00:01.234 --> 00:00:04.567
//   Hello world
export function srtToVtt(srt) {
    if (!srt) return 'WEBVTT\n\n';

    // Strip BOM if present.
    let text = srt.replace(/^\uFEFF/, '');

    // Already WebVTT? Return as-is (still ensure \n line endings).
    if (text.trimStart().startsWith('WEBVTT')) {
        return text.replace(/\r\n/g, '\n');
    }

    // Normalize line endings.
    text = text.replace(/\r\n|\r/g, '\n');

    // Replace timestamp commas with dots: 00:00:01,234 -> 00:00:01.234
    text = text.replace(
        /(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
        '$1.$2'
    );

    // Some SRT files use comma in only one side; normalize both.
    text = text.replace(
        /(\d{1,2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g,
        '$1 --> $2.$3'
    );

    // Strip standalone numeric cue indices that appear on a line by themselves
    // immediately before a timestamp line. WebVTT allows them but keeping them
    // can confuse some parsers when mixed with malformed SRT.
    // (We leave them in place; they're valid.)

    return 'WEBVTT\n\n' + text.trimStart();
}

// Detect whether a URL points to an SRT file.
export function isSrtUrl(url) {
    if (!url) return false;
    const u = url.split('?')[0].toLowerCase();
    return u.endsWith('.srt');
}

// Fetch a remote subtitle file and, if it's an SRT, transcode to VTT.
// Returns { body, contentType }.
export async function fetchSubtitleAsVtt(url) {
    const res = await fetch(url, { headers: { 'Accept': '*/*' } });
    if (!res.ok) {
        throw new Error(`Subtitle fetch failed: ${res.status}`);
    }
    const text = await res.text();

    // If response declares VTT or starts with WEBVTT, pass through.
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('vtt') || text.trimStart().startsWith('WEBVTT')) {
        return { body: text.replace(/\r\n/g, '\n'), contentType: 'text/vtt; charset=utf-8' };
    }

    // Otherwise treat as SRT and convert.
    return { body: srtToVtt(text), contentType: 'text/vtt; charset=utf-8' };
}
