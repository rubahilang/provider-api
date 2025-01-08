import express from 'express';
import dns from 'dns';
import { Resolver } from 'dns/promises';
import axios from 'axios';
import { URL } from 'url';
import https from 'https';
import ping from 'ping';

const app = express();
const PORT = process.env.PORT || 3000;

// Jika Anda menggunakan proxy, konfigurasi di sini
// import HttpsProxyAgent from 'https-proxy-agent';
// const proxy = 'http://your-proxy-address:port'; // Ganti dengan alamat proxy Anda
// const agent = new HttpsProxyAgent(proxy);

// Jika tidak menggunakan proxy, buat https.Agent dengan pengaturan default
const agent = new https.Agent({
    rejectUnauthorized: false, // Izinkan sertifikat tidak sah untuk deteksi
});

// Fungsi untuk membandingkan resolusi DNS operator vs publik
async function cekPerbedaanDNS(domain) {
    try {
        // Resolver default (DNS operator)
        const resolverOperator = new Resolver();
        // Jika Anda tahu IP DNS operator, set di sini
        // resolverOperator.setServers(['ip-dns-operator']);

        const operatorIPs = await resolverOperator.resolve4(domain);

        // Resolver publik (Google DNS)
        const resolverGoogle = new Resolver();
        resolverGoogle.setServers(['8.8.8.8', '8.8.4.4']);
        const googleIPs = await resolverGoogle.resolve4(domain);

        const operatorIPsSorted = operatorIPs.sort();
        const googleIPsSorted = googleIPs.sort();
        const isDifferent = JSON.stringify(operatorIPsSorted) !== JSON.stringify(googleIPsSorted);

        return {
            operatorIPs,
            googleIPs,
            isDifferent
        };
    } catch (error) {
        console.error(`Error checking DNS for ${domain}: ${error.message}`);
        return null;
    }
}

// Fungsi untuk melakukan ping ke domain
async function pingDomain(domain) {
    try {
        const res = await ping.promise.probe(domain);
        return res.alive;
    } catch (error) {
        console.error(`Error pinging ${domain}: ${error.message}`);
        return false;
    }
}

// Fungsi helper untuk mendeteksi apakah lokasi redirect mencurigakan
function isSuspiciousRedirect(redirectUrl = '') {
    const lowerUrl = redirectUrl.toLowerCase();
    const suspiciousKeywords = [
        'internet-positif',
        'trust+',
        'blocked',
        'diblokir',
        'blockpage',
        'axis',
        'xl'
    ];
    return suspiciousKeywords.some(keyword => lowerUrl.includes(keyword));
}

// Fungsi untuk mengecek apakah website diblokir
async function cekBlokir(targetUrl) {
    try {
        // Pastikan URL menggunakan HTTPS
        const parsedUrl = new URL(targetUrl);
        const protocol = parsedUrl.protocol;

        const httpsUrl = protocol === 'https:' ? targetUrl : `https://${parsedUrl.hostname}`;

        const response = await axios.get(httpsUrl, { 
            timeout: 10000,
            maxRedirects: 0, // Jangan ikuti redirects
            validateStatus: null, // Jangan lempar error untuk status tertentu
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            httpsAgent: agent
        });

        console.log(`\nChecking URL: ${httpsUrl}`);
        console.log(`Response Status: ${response.status}`);
        console.log(`Response Headers:`, response.headers);

        // Cek redirect
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const location = response.headers.location;
            console.log(`Redirect Location: ${location}`);
            if (isSuspiciousRedirect(location)) {
                console.log('Teridentifikasi sebagai pemblokiran melalui redirect.');
                return true;
            }
        }

        // Cek konten respons untuk kata kunci pemblokiran
        let body = '';
        if (typeof response.data === 'string') {
            body = response.data.toLowerCase();
        } else if (Buffer.isBuffer(response.data)) {
            body = response.data.toString('utf-8').toLowerCase();
        } else {
            body = JSON.stringify(response.data).toLowerCase();
        }

        console.log(`Response Body Snippet: ${body.substring(0, 200)}...`);

        const isBlocked =
            response.status === 403 || // Forbidden
            response.status === 451 || // Unavailable For Legal Reasons
            body.includes('internet positif') ||
            body.includes('trust+') ||
            body.includes('blocked') ||
            body.includes('diblokir') ||
            body.includes('axis') ||
            body.includes('xl');

        if (isBlocked) {
            console.log('Teridentifikasi sebagai pemblokiran berdasarkan status atau konten.');
        }

        return isBlocked;

    } catch (error) {
        // Tangani SSL errors dan lainnya
        if (error.code === 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH') {
            console.log('Terjadi kesalahan SSL: ERR_SSL_VERSION_OR_CIPHER_MISMATCH');
            return true;
        }

        if (error.code === 'ECONNREFUSED') {
            console.log('Koneksi ditolak oleh server.');
            return true;
        }

        if (error.code === 'ETIMEDOUT') {
            console.log('Koneksi time out.');
            return true;
        }

        if (error.code === 'ECONNRESET') {
            console.log('Koneksi reset oleh server.');
            return true;
        }

        console.error(`Error accessing ${targetUrl}: ${error.message}`);
        // Jika terjadi error lain, anggap diblokir
        return true;
    }
}

// Fungsi untuk memeriksa satu domain
const cekSatuDomain = async (domain) => {
    try {
        let targetUrl = domain;
        if (!/^https?:\/\//i.test(domain)) {
            targetUrl = 'https://' + domain; // Prefer HTTPS
        }

        const parsedUrl = new URL(targetUrl);
        const hostname = parsedUrl.hostname || domain;

        // Cek perbedaan DNS
        const dnsDifferences = await cekPerbedaanDNS(hostname);
        if (dnsDifferences && dnsDifferences.isDifferent) {
            console.log(`DNS perbedaan terdeteksi untuk ${hostname}`);
            return {
                [hostname]: {
                    blocked: true,
                    dns: dnsDifferences
                }
            };
        }

        // Cek ping
        const isPingAlive = await pingDomain(hostname);
        if (!isPingAlive) {
            console.log(`Ping gagal untuk ${hostname}`);
            return {
                [hostname]: {
                    blocked: true,
                    ping: false
                }
            };
        }

        // Cek pemblokiran via HTTP/HTTPS
        const isBlocked = await cekBlokir(targetUrl);
        
        // Format response yang sederhana
        return {
            [hostname]: {
                blocked: isBlocked
            }
        };

    } catch (error) {
        // Jika parsing URL gagal, anggap saja diblokir/invalid
        return {
            [domain]: {
                blocked: true
            }
        };
    }
};

// Endpoint /check
app.get('/check', async (req, res) => {
    const domainsParam = req.query.domains;

    if (!domainsParam) {
        return res.status(400).json({ 
            error: 'Parameter "domains" diperlukan.',
            example: '/check?domains=reddit.com'
        });
    }

    const domains = domainsParam.split(',')
        .map(domain => domain.trim())
        .filter(domain => domain.length > 0);

    if (domains.length === 0) {
        return res.status(400).json({ 
            error: 'Tidak ada domain valid yang diberikan.'
        });
    }

    try {
        const hasil = await Promise.all(domains.map(domain => cekSatuDomain(domain)));
        const combinedResult = Object.assign({}, ...hasil);
        res.json(combinedResult);
    } catch (error) {
        res.status(500).json({ 
            error: 'Terjadi kesalahan saat memeriksa domain.'
        });
    }
});

// Endpoint root
app.get('/', (req, res) => {
    res.send(`
        <h1>Website Checker API</h1>
        <p>Gunakan endpoint <code>/check?domains=domain1.com,domain2.com</code> untuk memeriksa status website dan informasi DNS.</p>
        <p>Contoh: <a href="/check?domains=reddit.com,vimeo.com">/check?domains=reddit.com,vimeo.com</a></p>
    `);
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});
