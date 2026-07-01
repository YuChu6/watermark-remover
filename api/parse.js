export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.method === 'POST' ? req.body : req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported platform' });

    try {
        const result = await parseByPlatform(url, platform);
        if (!result) throw new Error('Parse failed');
        res.status(200).json({ success: true, video_url: result.videoUrl, title: result.title, platform });
    } catch (err) {
        res.status(500).json({ error: 'Parse failed: ' + err.message });
    }
}

function detectPlatform(url) {
    if (/douyin\.com|iesdouyin\.com/i.test(url)) return 'douyin';
    if (/kuaishou\.com/i.test(url)) return 'kuaishou';
    if (/xhslink\.com|xiaohongshu\.com/i.test(url)) return 'xiaohongshu';
    return null;
}

async function parseByPlatform(url, platform) {
    const parsers = { douyin: parseDouyin, kuaishou: parseKuaishou, xiaohongshu: parseXiaohongshu };
    return parsers[platform](url);
}

// ========== 抖音 ==========
async function parseDouyin(shareUrl) {
    // Follow share link redirects to get real URL + item ID
    const realUrl = await followRedirects(shareUrl);
    const itemId = extractDouyinId(realUrl);
    if (!itemId) throw new Error('Cannot extract video ID');

    // Try multiple API sources
    const sources = [
        async () => {
            const apiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${itemId}`;
            const data = await fetchJson(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                    'Referer': 'https://www.iesdouyin.com/',
                }
            });
            const video = data?.item_list?.[0]?.video?.play_addr?.url_list?.[0];
            if (video) {
                const cleanVideo = video.replace('playwm', 'play').replace('watermark=1', 'watermark=0');
                return { videoUrl: cleanVideo, title: data.item_list[0].desc };
            }
            return null;
        },
        async () => {
            // Backup: use third-party API
            const data = await fetchJson(`https://tenapi.cn/v2/video/douyin?url=${encodeURIComponent(shareUrl)}`);
            if (data?.data?.video_url) return { videoUrl: data.data.video_url, title: data.data.title };
            return null;
        },
        async () => {
            const data = await fetchJson(`https://api.oioweb.cn/api/video/douyin?url=${encodeURIComponent(shareUrl)}`);
            if (data?.result?.url) return { videoUrl: data.result.url, title: data.result.title };
            return null;
        },
    ];

    for (const fn of sources) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (e) { /* continue */ }
    }
    throw new Error('All sources failed');
}

// ========== 快手 ==========
async function parseKuaishou(shareUrl) {
    const realUrl = await followRedirects(shareUrl);

    // Try APIs
    const sources = [
        async () => {
            const data = await fetchJson(`https://tenapi.cn/v2/video/kuaishou?url=${encodeURIComponent(shareUrl)}`);
            if (data?.data?.video_url) return { videoUrl: data.data.video_url, title: data.data.title };
            return null;
        },
        async () => {
            // Extract from page HTML
            const html = await fetchText(realUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' }
            });
            const match = html.match(/"srcNoMark":"([^"]+)"/) || html.match(/"photoUrl":"([^"]+)"/);
            if (match) return { videoUrl: match[1].replace(/\\u002F/g, '/'), title: '' };
            return null;
        },
    ];

    for (const fn of sources) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (e) { /* continue */ }
    }
    throw new Error('All sources failed');
}

// ========== 小红书 ==========
async function parseXiaohongshu(shareUrl) {
    const sources = [
        async () => {
            const data = await fetchJson(`https://api.oioweb.cn/api/video/xiaohongshu?url=${encodeURIComponent(shareUrl)}`);
            if (data?.result?.url) return { videoUrl: data.result.url, title: data.result.title };
            return null;
        },
    ];

    for (const fn of sources) {
        try {
            const result = await fn();
            if (result) return result;
        } catch (e) { /* continue */ }
    }
    throw new Error('All sources failed');
}

// ========== Helpers ==========
async function followRedirects(url, maxRedirects = 5) {
    let current = url;
    for (let i = 0; i < maxRedirects; i++) {
        const resp = await fetch(current, { method: 'HEAD', redirect: 'manual' });
        const location = resp.headers.get('location');
        if (!location) return current;
        current = new URL(location, current).href;
    }
    return current;
}

function extractDouyinId(url) {
    const patterns = [
        /video\/(\d+)/,
        /note\/(\d+)/,
        /modal_id=(\d+)/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

async function fetchJson(url, opts = {}) {
    const resp = await fetch(url, { ...opts, timeout: 10000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

async function fetchText(url, opts = {}) {
    const resp = await fetch(url, { ...opts, timeout: 10000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}
