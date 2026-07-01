// Cloudflare Worker - 视频解析代理
// 部署后把下方的 WORKER_URL 换成你的 worker 地址

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const videoUrl = url.searchParams.get('url');
    if (!videoUrl) {
      return jsonResponse({ error: 'Missing url parameter' }, 400);
    }

    let platform;
    if (/douyin\.com|iesdouyin\.com/i.test(videoUrl)) platform = 'douyin';
    else if (/kuaishou\.com/i.test(videoUrl)) platform = 'kuaishou';
    else if (/xhslink\.com|xiaohongshu\.com/i.test(videoUrl)) platform = 'xiaohongshu';
    else return jsonResponse({ error: 'Unsupported platform' }, 400);

    try {
      const result = await parseVideo(videoUrl, platform);
      return jsonResponse(result);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};

async function parseVideo(videoUrl, platform) {
  const parsers = { douyin: parseDouyin, kuaishou: parseKuaishou, xiaohongshu: parseXHS };
  const result = await parsers[platform](videoUrl);
  if (!result) throw new Error('Parse failed');
  return { success: true, video_url: result.url, title: result.title || '' };
}

// ===== 抖音 =====
async function parseDouyin(shareUrl) {
  // 第一步：跟随分享链接获取真实URL和视频ID
  const realUrl = await followRedirect(shareUrl);
  const itemId = realUrl.match(/video\/(\d+)/)?.[1] || realUrl.match(/note\/(\d+)/)?.[1];
  if (!itemId) {
    // 尝试通过第三方API
    return await tryThirdParty(shareUrl, 'douyin');
  }

  // 第二步：用官方API获取无水印视频
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
  
  const apiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${itemId}`;
  const resp = await fetch(apiUrl, { headers: { 'User-Agent': ua, 'Referer': 'https://www.douyin.com/' } });
  const data = await resp.json();
  
  const video = data?.item_list?.[0];
  if (video) {
    let rawUrl = video.video?.play_addr?.url_list?.[0];
    if (rawUrl) {
      rawUrl = rawUrl.replace('playwm', 'play');
      return { url: rawUrl, title: video.desc || '' };
    }
  }
  
  // 官方API失败走第三方
  return await tryThirdParty(shareUrl, 'douyin');
}

// ===== 快手 =====
async function parseKuaishou(shareUrl) {
  const result = await tryThirdParty(shareUrl, 'kuaishou');
  if (result) return result;

  // 直接解析页面
  const realUrl = await followRedirect(shareUrl);
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15';
  const html = await fetch(realUrl, { headers: { 'User-Agent': ua } }).then(r => r.text());
  
  const match = html.match(/"srcNoMark":"([^"]+)"/) || html.match(/"photoUrl":"([^"]+)"/);
  if (match) {
    return { url: unescapeJson(match[1]), title: '' };
  }
  return null;
}

// ===== 小红书 =====
async function parseXHS(shareUrl) {
  return await tryThirdParty(shareUrl, 'xiaohongshu');
}

// ===== 第三方API回退 =====
async function tryThirdParty(shareUrl, platform) {
  const apis = {
    douyin: ['https://tenapi.cn/v2/video/douyin?url=', 'https://api.oioweb.cn/api/video/douyin?url='],
    kuaishou: ['https://tenapi.cn/v2/video/kuaishou?url='],
    xiaohongshu: ['https://api.oioweb.cn/api/video/xiaohongshu?url='],
  };
  
  for (const base of (apis[platform] || [])) {
    try {
      const resp = await fetch(base + encodeURIComponent(shareUrl), { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await resp.json();
      let videoUrl = data?.data?.video_url || data?.result?.url || data?.data?.url;
      if (videoUrl) {
        return { url: videoUrl, title: data?.data?.title || data?.result?.title || '' };
      }
    } catch (e) { continue; }
  }
  return null;
}

async function followRedirect(url) {
  const resp = await fetch(url, { redirect: 'manual' });
  const location = resp.headers.get('Location');
  if (location) {
    const absolute = new URL(location, url).href;
    // 再跟一次（有些链接需要两次跳转）
    const resp2 = await fetch(absolute, { redirect: 'manual' });
    const loc2 = resp2.headers.get('Location');
    return loc2 ? new URL(loc2, absolute).href : absolute;
  }
  return url;
}

function unescapeJson(s) {
  return s.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
