/*
 * @Author       : HCLonely
 * @Date         : 2026-01-16 18:29:51
 * @LastEditTime : 2026-01-29 11:29:01
 * @LastEditors  : HCLonely
 * @FilePath     : /awesome-bilibili-extra/src/getItems.js
 * @Description  :
 */

const axios = require('axios');
const { parse } = require('yaml');
const fs = require('fs');

async function getItems() {
  const allResults = [];

  // Helper function to delay execution
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Helper function to make request with retry logic
  const makeRequest = async (page, retries = 0) => {
    try {
      const url = `https://github.com/search?q=bili&type=repositories&s=updated&o=desc&p=${page}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      return response.data;
    } catch (error) {
      if (retries < 10) {
        console.log(`Page ${page} failed, retrying in 5s... (attempt ${retries + 1}/10)`);
        await delay(5000);
        return makeRequest(page, retries + 1);
      } else {
        console.error(`Page ${page} failed after 10 retries:`, error.message);
        return null;
      }
    }
  };

  // Helper function to extract JSON data from HTML
  const extractJsonData = (html) => {
    const scriptRegex = /<script type="application\/json" data-target="react-app\.embeddedData">(.*?)<\/script>/s;
    const match = html.match(scriptRegex);

    if (match && match[1]) {
      try {
        const jsonData = JSON.parse(match[1]);
        return jsonData.payload?.results || [];
      } catch (error) {
        console.error('Failed to parse JSON data:', error.message);
        return [];
      }
    }
    return [];
  };

  // Helper function to process results
  const processResults = (results) => {
    return results
      .filter(item => item.hl_trunc_description !== null)
      .map(item => {
        const cleanName = item.hl_name
          .replace(/\\u003cem\\u003e/g, '')
          .replace(/\\u003c\/em\\u003e/g, '')
          .replace(/<em>/g, '')
          .replace(/<\/em>/g, '');

        return {
          hl_name: cleanName,
          hl_trunc_description: item.hl_trunc_description,
          hl_link: `https://github.com/${cleanName}`
        };
      })
      .filter((item) => !item.hl_name.toLowerCase().includes('bilingual'));
  };

  // Main loop to fetch all 100 pages
  for (let page = 1; page <= 100; page++) {
    console.log(`Fetching page ${page}/100...`);

    const html = await makeRequest(page);
    if (html) {
      const results = extractJsonData(html);
      const processedResults = processResults(results);
      allResults.push(...processedResults);
      console.log(`Page ${page}: Found ${processedResults.length} valid items`);
    }

    // Wait 10 seconds before next request (except for the last page)
    if (page < 100) {
      await delay(10000);
    }
  }

  console.log(`Total items collected: ${allResults.length}`);
  return allResults;
}

function getFilesPath(dir) {
  const path = require('path');
  const ymlFiles = [];

  function readDirRecursive(currentDir) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        readDirRecursive(fullPath);
      } else if (stat.isFile() && path.extname(item) === '.yml') {
        ymlFiles.push(fullPath);
      }
    }
  }

  readDirRecursive(dir);
  return ymlFiles;
}

async function uniqueItems() {
  const items = await getItems();
  const filesPath = getFilesPath('RAW_DATA');

  const existedLinks = new Set();

  for (const filePath of filesPath) {
    try {
      const yamlContent = fs.readFileSync(filePath, 'utf8');
      const yamlData = parse(yamlContent);

      if (Array.isArray(yamlData)) {
        yamlData.forEach(item => {
          if (item.from === 'github' && item.link) {
            existedLinks.add(item.link);
          }
        });
      }
    } catch (error) {
      console.error(`Error reading YAML file ${filePath}:`, error.message);
    }
  }

  const uniqueItems = items.filter(item => {
    return !existedLinks.has(item.hl_name);
  });

  // console.log(uniqueItems);
  return uniqueItems;
}

async function openPage() {
  const items = await uniqueItems();
  const { spawn } = require('child_process');
  const readline = require('readline');

  console.log(`Found ${items.length} unique items to open`);

  if (items.length === 0) {
    console.log('No new items to open!');
    return;
  }

  // 如果items<=20, 打开所有的items.hl_link
  if (items.length <= 20) {
    console.log('Opening all links...');
    items.forEach(item => {
      console.log(`Opening: ${item.hl_name} - ${item.hl_link}`);
      spawn('cmd', ['/c', 'start', item.hl_link], { stdio: 'ignore' });
    });
    return;
  }

  // 否则，分批打开
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let currentIndex = 0;
  const batchSize = 10;

  const openBatch = async () => {
    const endIndex = Math.min(currentIndex + batchSize, items.length);
    const batch = items.slice(currentIndex, endIndex);

    console.log(`\nOpening batch ${Math.floor(currentIndex / batchSize) + 1} (${currentIndex + 1}-${endIndex} of ${items.length}):`);

    batch.forEach((item, index) => {
      console.log(`${currentIndex + index + 1}. ${item.hl_name} - ${item.hl_link}`);
      spawn('cmd', ['/c', 'start', item.hl_link], { stdio: 'ignore' });
    });

    currentIndex = endIndex;

    if (currentIndex >= items.length) {
      console.log('\nAll links have been opened!');
      rl.close();
      return;
    }

    // 等待用户交互
    rl.question(`\nPress Enter to open next batch (${currentIndex + 1}-${Math.min(currentIndex + batchSize, items.length)} of ${items.length})...`, () => {
      openBatch();
    });
  };

  await openBatch();
}

openPage();
