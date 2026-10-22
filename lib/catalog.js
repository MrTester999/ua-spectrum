const WINDOWS = [
  "Windows NT 10.0; Win64; x64",
  "Windows NT 10.0; WOW64",
  "Windows NT 11.0; Win64; x64",
  "Windows NT 10.0; ARM64"
];

const LINUX = [
  "X11; Linux x86_64",
  "X11; Ubuntu; Linux x86_64",
  "X11; Fedora; Linux x86_64"
];

const MAC = ["10_15_7", "11_7_10", "12_7_6", "13_6_9", "14_7_2", "15_2_0"];
const IOS = ["16_7", "17_4", "17_7", "18_0", "18_1", "18_2"];
const ANDROID = [
  ["10", "SM-G973F"], ["11", "Pixel 5"], ["12", "SM-G991B"],
  ["13", "Pixel 7"], ["13", "SM-S918B"], ["14", "Pixel 8 Pro"],
  ["14", "SM-A546B"], ["15", "Pixel 9 Pro"]
];

let cache = null;
const poolCache = new Map();

function chromeUa(platform, major, build, patch) {
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Safari/537.36`;
}

function add(out, ua, browser, platform) {
  out.push({ ua, browser, platform });
}

export function buildCatalog() {
  if (cache) return cache;
  const out = [];

  for (let major = 120; major <= 146; major += 1) {
    for (let variant = 0; variant < 12; variant += 1) {
      const build = 6099 + (major - 120) * 53 + variant * 7;
      const patch = 20 + variant * 9;
      for (const token of WINDOWS) add(out, chromeUa(token, major, build, patch), "Chrome", "Windows");
      for (const token of LINUX) add(out, chromeUa(token, major, build, patch), "Chrome", "Linux");
      for (const version of MAC) {
        add(out, chromeUa(`Macintosh; Intel Mac OS X ${version}`, major, build, patch), "Chrome", "macOS");
      }
      for (const [android, device] of ANDROID) {
        add(out, `Mozilla/5.0 (Linux; Android ${android}; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.${patch} Mobile Safari/537.36`, "Chrome", "Android");
      }
    }

    for (let variant = 0; variant < 8; variant += 1) {
      const build = 2500 + (major - 120) * 41 + variant * 11;
      for (const token of WINDOWS) {
        add(out, `${chromeUa(token, major, build, variant * 5)} Edg/${major}.0.${build}.${variant * 5}`, "Edge", "Windows");
      }
    }
  }

  for (let major = 115; major <= 145; major += 1) {
    for (let patch = 0; patch < 5; patch += 1) {
      for (const token of WINDOWS) {
        add(out, `Mozilla/5.0 (${token}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0${patch ? `.${patch}` : ""}`, "Firefox", "Windows");
      }
      for (const token of LINUX) {
        add(out, `Mozilla/5.0 (${token}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0${patch ? `.${patch}` : ""}`, "Firefox", "Linux");
      }
      for (const version of MAC) {
        add(out, `Mozilla/5.0 (Macintosh; Intel Mac OS X ${version}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`, "Firefox", "macOS");
      }
    }
  }

  for (let safari = 16; safari <= 18; safari += 1) {
    for (let webkit = 600; webkit < 626; webkit += 1) {
      for (const version of MAC) {
        add(out, `Mozilla/5.0 (Macintosh; Intel Mac OS X ${version}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari}.${webkit % 10} Safari/605.1.15`, "Safari", "macOS");
      }
      for (const version of IOS) {
        add(out, `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safari}.0 Mobile/15E148 Safari/604.1`, "Safari", "iOS");
      }
    }
  }

  const unique = new Map(out.map((entry) => [entry.ua, entry]));
  cache = Object.freeze([...unique.values()]);
  return cache;
}

export function pickAgent(filters = {}, previous = "") {
  const catalog = buildCatalog();
  const browsers = [...(filters.browsers || [])].sort();
  const platforms = [...(filters.platforms || [])].sort();
  const key = `${browsers.join(",")}|${platforms.join(",")}`;
  let pool = poolCache.get(key);
  if (!pool) {
    const enabledBrowsers = new Set(browsers);
    const enabledPlatforms = new Set(platforms);
    pool = catalog.filter((entry) =>
      (!enabledBrowsers.size || enabledBrowsers.has(entry.browser)) &&
      (!enabledPlatforms.size || enabledPlatforms.has(entry.platform))
    );
    poolCache.set(key, pool);
  }
  const source = pool.length ? pool : catalog;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  let selected = source[random[0] % source.length];
  if (source.length > 1 && selected.ua === previous) {
    selected = source[(random[0] + 1) % source.length];
  }
  return selected;
}

export function catalogStats() {
  const catalog = buildCatalog();
  return {
    total: catalog.length,
    browsers: [...new Set(catalog.map((entry) => entry.browser))],
    platforms: [...new Set(catalog.map((entry) => entry.platform))]
  };
}
