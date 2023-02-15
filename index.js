const puppeteer = require('puppeteer');
const fs = require('fs');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const path = require('path');

const RESULTS_DIR = './results';
const URLS_FILE = './urls.txt';
const REGIONS_FILE = './regions.txt';

const selectors = {
  regionLink: 'div[class^="FirstHeader_region"]',
  regionItem: '[class^="RegionModal_item"]',
  price: '[class^="Price_priceDesktop"]',
  oldPrice: '[class^="BuyQuant_oldPrice"]',
  ratingCount: '[itemprop="ratingCount"]',
  reviewCount: '[itemprop="reviewCount"]',
  name: '[class^="Title_title"]',
};

let getProductInfo = async (url, region = undefined, index, count) => {
  console.log(`Parsing page ${index} from ${count}`);
  console.log(`Launching browser...`);
  const browser = await puppeteer.launch({
    headless: true,
  });
  console.log(`Creating new page...`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 800 });
  console.log(`Navigating to ${url}...`);
  await page.goto(url);
  await page.waitForNavigation({ waitUntil: 'load' });
  if (region) {
    await page.waitForSelector(selectors.regionLink);
    console.log(`Selecting region "${region}"...`);
    const regionLink = await page.$(selectors.regionLink);
    await regionLink.click();
    await page.waitForSelector(selectors.regionItem);
    const regionList = await page.$$(selectors.regionItem);
    const regionElement = await Promise.all(
      regionList.map(async (el) => {
        const text = await el.evaluate((node) => node.innerText.trim());
        if (text === region) {
          return el;
        }
      })
    ).then((elements) => elements.find((el) => el !== undefined));
    if (regionElement) {
      await regionElement.click();
      await page.waitForNavigation({
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector(selectors.price);
    } else {
      throw `Region "${region}" not found. Parser stopped.`;
    }
  } else {
    const regionLink = await page.$(selectors.regionLink);
    region = await regionLink.evaluate((node) => {
      return node.innerText.trim();
    });
    console.log(`Region not selected. Used home region "${region}".`);
  }
  const productDir = path.resolve(__dirname, RESULTS_DIR, region.replaceAll('.', ' ').replaceAll(' ', '_'), url.split('/').pop());
  await createDir(productDir);
  const nameElement = await page.$(selectors.name);
  const name = await nameElement.evaluate((node) => {
    return node.innerText.trim();
  });
  console.log(`Taking a full page screenshot...`);
  await page.screenshot({
    path: path.resolve(productDir, 'screenshot.jpg'),
    fullPage: true,
  });
  console.log(`Getting product info...`);
  const priceElement = await page.$(selectors.price);
  const price = await priceElement.evaluate((node) => {
    const text = node.innerText.trim();
    return parseFloat(text.replace(/,/g, '.'));
  });
  const oldPriceElement = await page.$(selectors.oldPrice);
  const oldPrice = oldPriceElement
    ? await oldPriceElement.evaluate((node) => {
        const text = node.innerText.trim();
        return parseFloat(text.replace(/,/g, '.'));
      })
    : null;
  const ratingCountElement = await page.$(selectors.ratingCount);
  const rating = await ratingCountElement.evaluate((node) => {
    const ratingCount = node.getAttribute('content');
    return parseFloat(ratingCount);
  });
  const reviewCountElement = await page.$(selectors.reviewCount);
  const reviewCount = await reviewCountElement.evaluate((node) => {
    const reviewCount = node.getAttribute('content');
    return parseInt(reviewCount);
  });

  console.log(`Saving product info to file...`);
  const productInfo = {
    name,
    region,
    price: price.toFixed(1),
    rating: rating.toFixed(1),
    reviewCount,
    url,
  };
  if (oldPrice) {
    productInfo.priceOld = oldPrice.toFixed(1);
  }
  await writeFileAsync(
    path.resolve(productDir, 'product.txt'),
    Object.entries(productInfo)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  );

  console.log(`Closing browser...`);
  await browser.close();
};

let readLine = (file) => {
  if (!fs.existsSync(path.resolve(__dirname, file))) {
    return undefined;
  }
  const result = [];
  const fileContent = fs.readFileSync(file, 'utf-8');
  const lines = fileContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line !== '') {
      result.push(line);
    }
  }

  return result;
};

let getUrls = () =>
  process.argv.length > 2
    ? [process.argv[2]]
    : readLine(path.resolve(__dirname, URLS_FILE));
let getRegions = () =>
  process.argv.length > 3
    ? [process.argv[3]]
    : readLine(path.resolve(__dirname, REGIONS_FILE));

let createDir = async (dir) => {
  if (!fs.existsSync(path.resolve(__dirname, dir))) {
    await mkdir(path.resolve(__dirname, dir), { recursive: true });
  }
};

let main = async () => {
  await createDir(RESULTS_DIR);
  let urls = getUrls();
  let regions = getRegions();
  if (!urls.length) {
    throw 'No URL to parse. Specify the url as the first argument when starting the program or the list of urls in the urls.txt file separated by newline.';
  }
  for (let i = 0; i < urls.length; i++) {
    await getProductInfo(urls[i], regions ? regions[i] : undefined, i + 1, urls.length);
  }
  console.log('Parsing done.');
};

try {
  main();
} catch (error) {
  console.log(error);
  process.exit(1);
}
