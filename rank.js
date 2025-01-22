import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
const PORT = process.env.PORT || 3000;

async function performSearch(keyword) {
  // Membuka browser Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu'
    ]
  });
  
  const page = await browser.newPage();
  
  // Set User-Agent agar terdeteksi seperti browser umum
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36'
  );
  
  // Siapkan query
  const query = encodeURIComponent(keyword.replace(/\+/g, ' '));
  
  // Buka halaman pencarian
  await page.goto(`https://www.google.com/search?q=${query}&num=20`, {
    waitUntil: ['load', 'networkidle2'],
    timeout: 0 // Bisa di-set agar tidak timeout terlalu cepat
  });

  // [OPSIONAL] Menangani popup "Terima semua" (cookie consent), jika muncul
  try {
    // Selector tombol "Terima semua" bisa berubah tergantung bahasa/region, 
    // contohnya: button[id="L2AGLb"] atau [aria-label="Terima semua"]
    await page.waitForSelector('button[aria-label="Accept all"]', { timeout: 5000 });
    await page.click('button[aria-label="Accept all"]');
    await page.waitForTimeout(2000); // jeda sebentar
  } catch (err) {
    // Jika tidak ketemu tombol atau sudah pernah accept, abaikan saja
  }

  let organicResults = [];
  
  try {
    // Tunggu sampai element hasil pencarian muncul
    // Gunakan selector yang sedikit lebih spesifik: `#search div.g`
    await page.waitForSelector('#search div.g', { timeout: 60000 });
    
    // Ambil data hasil pencarian
    organicResults = await page.evaluate(() => {
      const results = [];
      // Ambil semua div.g yang ada di dalam #search
      const resultElements = document.querySelectorAll('#search div.g');
      
      resultElements.forEach((element) => {
        // Batasi hanya 10 hasil teratas
        if (results.length >= 10) return;
        
        const titleTag = element.querySelector('h3');
        const linkTag = element.querySelector('a');
        const snippetTag = element.querySelector('.VwiC3b');
        const displayedLinkTag = element.querySelector('cite');
        
        if (titleTag && linkTag) {
          results.push({
            position: results.length + 1,
            title: titleTag.innerText,
            link: linkTag.href,
            displayed_link: displayedLinkTag ? displayedLinkTag.innerText : '',
            snippet: snippetTag ? snippetTag.innerText : '',
            review: ''
          });
        }
      });
      
      return results;
    });
  } catch (err) {
    console.warn('No results found or selector issue:', err);
    // Jika tetap gagal, biarkan organicResults menjadi array kosong
  }
  
  await browser.close();
  return organicResults;
}

app.get('/api/', async (req, res) => {
  try {
    let { keyword, domain } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: 'Parameter "keyword" diperlukan.' });
    }
    if (domain) {
      // Menambahkan filter site:domain jika user memasukkan domain
      keyword += ` site:${domain}`;
    }
    
    const processedAt = new Date().toISOString();
    const organicResults = await performSearch(keyword);

    const responseJson = {
      search_metadata: {
        id: '',
        status: "success",
        created_at: new Date().toISOString(),
        processed_at: processedAt
      },
      search_parameters: {
        domain: 'google.com',
        lang: 'id',
        country: 'IN',
        location: 'Jakarta, Indonesia',
        q: keyword,
        device: 'mobile',
        url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`,
        num: 100,
        sourceid: 'chrome',
        ie: 'UTF-8'
      },
      results: {
        organic: organicResults
      }
    };

    res.json(responseJson);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Terjadi kesalahan saat melakukan pencarian.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server berjalan pada port ${PORT}`);
});
