import express from 'express';
import dns from 'dns';
import fetch from 'node-fetch';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import { Resolver } from 'dns/promises';
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

    <!DOCTYPE html>
    <html dir="ltr" lang="en">
    <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <style>
    @charset "utf-8";

button { border: 0px; border-radius: 20px; box-sizing: border-box; color: var(--primary-button-text-color); cursor: pointer; float: right; font-size: 0.875em; margin: 0px; padding: 8px 16px; transition: box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1); user-select: none; }

[dir="rtl"] button { float: left; }

.bad-clock button, .captive-portal button, .https-only button, .insecure-form button, .lookalike-url button, .main-frame-blocked button, .neterror button, .pdf button, .ssl button, .enterprise-block button, .enterprise-warn button, .managed-profile-required button, .safe-browsing-billing button, .supervised-user-verify button, .supervised-user-verify-subframe button { background: var(--primary-button-fill-color); }

button:active { background: var(--primary-button-fill-color-active); outline: 0px; }

#debugging { display: inline; overflow: auto; }

.debugging-content { line-height: 1em; margin-bottom: 0px; margin-top: 1em; }

.debugging-content-fixed-width { display: block; font-family: monospace; font-size: 1.2em; margin-top: 0.5em; }

.debugging-title { font-weight: bold; }

#details { margin: 0px 0px 50px; }

#details p:not(:first-of-type) { margin-top: 20px; }

.secondary-button:active { border-color: white; box-shadow: rgba(60, 64, 67, 0.3) 0px 1px 2px 0px, rgba(60, 64, 67, 0.15) 0px 2px 6px 2px; }

.secondary-button:hover { background: var(--secondary-button-hover-fill-color); border-color: var(--secondary-button-hover-border-color); text-decoration: none; }

.error-code { color: var(--error-code-color); font-size: 0.8em; margin-top: 12px; text-transform: uppercase; }

#error-debugging-info { font-size: 0.8em; }

h1 { color: var(--heading-color); font-size: 1.6em; font-weight: normal; line-height: 1.25em; margin-bottom: 16px; }

h2 { font-size: 1.2em; font-weight: normal; }

.icon { height: 72px; margin: 0px 0px 40px; width: 72px; }

input[type="checkbox"] { opacity: 0; }

input[type="checkbox"]:focus ~ .checkbox::after { outline: -webkit-focus-ring-color auto 5px; }

.interstitial-wrapper { box-sizing: border-box; font-size: 1em; line-height: 1.6em; margin: 14vh auto 0px; max-width: 600px; width: 100%; }

#main-message > p { display: inline; }

#extended-reporting-opt-in { font-size: 0.875em; margin-top: 32px; }

#extended-reporting-opt-in label { display: grid; grid-template-columns: 1.8em 1fr; position: relative; }

#enhanced-protection-message { border-radius: 20px; font-size: 1em; margin-top: 32px; padding: 10px 5px; }

#enhanced-protection-message a { color: var(--google-red-10); }

#enhanced-protection-message label { display: grid; grid-template-columns: 2.5em 1fr; position: relative; }

#enhanced-protection-message div { margin: 0.5em; }

#enhanced-protection-message .icon { height: 1.5em; vertical-align: middle; width: 1.5em; }

.nav-wrapper { margin-top: 51px; }

.nav-wrapper::after { clear: both; content: ""; display: table; width: 100%; }

.small-link { color: var(--small-link-color); font-size: 0.875em; }

.checkboxes { flex: 0 0 24px; }

.checkbox { --padding: .9em; background: transparent; display: block; height: 1em; left: -1em; padding-inline-start: var(--padding); position: absolute; right: 0px; top: -0.5em; width: 1em; }

.checkbox::after { border: 1px solid white; border-radius: 2px; content: ""; height: 1em; left: var(--padding); position: absolute; top: var(--padding); width: 1em; }

.checkbox::before { background: transparent; border-width: 0px 2px 2px; border-style: solid; border-color: white; border-image: initial; border-inline-end-width: 0px; content: ""; height: 0.2em; left: calc(.3em + var(--padding)); opacity: 0; position: absolute; top: calc(.3em  + var(--padding)); transform: rotate(-45deg); width: 0.5em; }

input[type="checkbox"]:checked ~ .checkbox::before { opacity: 1; }

#recurrent-error-message { background: rgb(237, 237, 237); border-radius: 4px; margin-bottom: 16px; margin-top: 12px; padding: 12px 16px; }

.showing-recurrent-error-message #extended-reporting-opt-in { margin-top: 16px; }

.showing-recurrent-error-message #enhanced-protection-message { margin-top: 16px; }

@media (max-width: 700px) {
  .interstitial-wrapper { padding: 0px 10%; }
  #error-debugging-info { overflow: auto; }
}

@media (max-width: 420px) {
  button, [dir="rtl"] button, .small-link { float: none; font-size: 0.825em; font-weight: 500; margin: 0px; width: 100%; }
  button { padding: 16px 24px; }
  #details { margin: 20px 0px; }
  #details p:not(:first-of-type) { margin-top: 10px; }
  .secondary-button:not(.hidden) { display: block; margin-top: 20px; text-align: center; width: 100%; }
  .interstitial-wrapper { padding: 0px 5%; }
  #extended-reporting-opt-in { margin-top: 24px; }
  #enhanced-protection-message { margin-top: 24px; }
  .nav-wrapper { margin-top: 30px; }
}

@media (max-width: 420px) {
  .nav-wrapper .secondary-button { border: 0px; margin: 16px 0px 0px; margin-inline-end: 0px; padding-bottom: 16px; padding-top: 16px; }
}

@media (min-width: 240px) and (max-width: 420px) and (min-height: 401px), (min-width: 421px) and (min-height: 240px) and (max-height: 560px) {
  body .nav-wrapper { background: var(--background-color); bottom: 0px; box-shadow: 0 -12px 24px var(--background-color); left: 0px; margin: 0px auto; max-width: 736px; padding-inline: 24px; position: fixed; right: 0px; width: 100%; z-index: 2; }
  .interstitial-wrapper { max-width: 736px; }
  #details, #main-content { padding-bottom: 40px; }
  #details { padding-top: 5.5vh; }
  button.small-link { color: var(--google-blue-600); }
}

@media (max-width: 420px) and (orientation: portrait), (max-height: 560px) {
  body { margin: 0px auto; }
  button, [dir="rtl"] button, button.small-link, .nav-wrapper .secondary-button { font-family: Roboto-Regular, Helvetica; font-size: 0.933em; margin: 6px 0px; transform: translateZ(0px); }
  .nav-wrapper { box-sizing: border-box; padding-bottom: 8px; width: 100%; }
  #details { box-sizing: border-box; height: auto; margin: 0px; opacity: 1; transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1); }
  #details.hidden, #main-content.hidden { height: 0px; opacity: 0; overflow: hidden; padding-bottom: 0px; transition: none; }
  h1 { font-size: 1.5em; margin-bottom: 8px; }
  .icon { margin-bottom: 5.69vh; }
  .interstitial-wrapper { box-sizing: border-box; margin: 7vh auto 12px; padding: 0px 24px; position: relative; }
  .interstitial-wrapper p { font-size: 0.95em; line-height: 1.61em; margin-top: 8px; }
  #main-content { margin: 0px; transition: opacity 100ms cubic-bezier(0.4, 0, 0.2, 1); }
  .small-link { border: 0px; }
  .suggested-left > #control-buttons, .suggested-right > #control-buttons { float: none; margin: 0px; }
}

@media (min-width: 421px) and (min-height: 500px) and (max-height: 560px) {
  .interstitial-wrapper { margin-top: 10vh; }
}

@media (min-height: 400px) and (orientation: portrait) {
  .interstitial-wrapper { margin-bottom: 145px; }
}

@media (min-height: 299px) {
  .nav-wrapper { padding-bottom: 16px; }
}

@media (max-height: 560px) and (min-height: 240px) and (orientation: landscape) {
  .extended-reporting-has-checkbox #details { padding-bottom: 80px; }
}

@media (min-height: 500px) and (max-height: 650px) and (max-width: 414px) and (orientation: portrait) {
  .interstitial-wrapper { margin-top: 7vh; }
}

@media (min-height: 650px) and (max-width: 414px) and (orientation: portrait) {
  .interstitial-wrapper { margin-top: 10vh; }
}

@media (max-height: 400px) and (orientation: portrait), (max-height: 239px) and (orientation: landscape), (max-width: 419px) and (max-height: 399px) {
  .interstitial-wrapper { display: flex; flex-direction: column; margin-bottom: 0px; }
  #details { flex: 1 1 auto; order: 0; }
  #main-content { flex: 1 1 auto; order: 0; }
  .nav-wrapper { flex: 0 1 auto; margin-top: 8px; order: 1; padding-inline: 0px; position: relative; width: 100%; }
  button, .nav-wrapper .secondary-button { padding: 16px 24px; }
  button.small-link { color: var(--google-blue-600); }
}

@media (max-width: 239px) and (orientation: portrait) {
  .nav-wrapper { padding-inline: 0px; }
}

@charset "utf-8"; a {
    color: var(--link-color);
}

body {
    --background-color: #fff;
    --error-code-color: var(--google-gray-700);
    --google-blue-50: rgb(232, 240, 254);
    --google-blue-100: rgb(210, 227, 252);
    --google-blue-300: rgb(138, 180, 248);
    --google-blue-600: rgb(26, 115, 232);
    --google-blue-700: rgb(25, 103, 210);
    --google-gray-100: rgb(241, 243, 244);
    --google-gray-300: rgb(218, 220, 224);
    --google-gray-500: rgb(154, 160, 166);
    --google-gray-50: rgb(248, 249, 250);
    --google-gray-600: rgb(128, 134, 139);
    --google-gray-700: rgb(95, 99, 104);
    --google-gray-800: rgb(60, 64, 67);
    --google-gray-900: rgb(32, 33, 36);
    --heading-color: var(--google-gray-900);
    --link-color: rgb(88, 88, 88);
    --popup-container-background-color: rgba(0,0,0,.65);
    --primary-button-fill-color-active: var(--google-blue-700);
    --primary-button-fill-color: var(--google-blue-600);
    --primary-button-text-color: #fff;
    --quiet-background-color: rgb(247, 247, 247);
    --secondary-button-border-color: var(--google-gray-500);
    --secondary-button-fill-color: #fff;
    --secondary-button-hover-border-color: var(--google-gray-600);
    --secondary-button-hover-fill-color: var(--google-gray-50);
    --secondary-button-text-color: var(--google-gray-700);
    --small-link-color: var(--google-gray-700);
    --text-color: var(--google-gray-700);
    background: var(--background-color);
    color: var(--text-color);
    overflow-wrap: break-word;
}

.nav-wrapper .secondary-button {
    background: var(--secondary-button-fill-color);
    border: 1px solid var(--secondary-button-border-color);
    color: var(--secondary-button-text-color);
    float: none;
    margin: 0px;
    padding: 8px 16px;
}

.hidden {
    display: none;
}

html {
    text-size-adjust: 100%;
    font-size: 125%;
}

.icon {
    background-repeat: no-repeat;
    background-size: 100%;
}

@media (prefers-color-scheme: dark) {
    body {
        --background-color: var(--google-gray-900);
        --error-code-color: var(--google-gray-500);
        --heading-color: var(--google-gray-500);
        --link-color: var(--google-blue-300);
        --primary-button-fill-color-active: rgb(129, 162, 208);
        --primary-button-fill-color: var(--google-blue-300);
        --primary-button-text-color: var(--google-gray-900);
        --quiet-background-color: var(--background-color);
        --secondary-button-border-color: var(--google-gray-700);
        --secondary-button-fill-color: var(--google-gray-900);
        --secondary-button-hover-fill-color: rgb(48, 51, 57);
        --secondary-button-text-color: var(--google-blue-300);
        --small-link-color: var(--google-blue-300);
        --text-color: var(--google-gray-500);
    }
}

@charset "utf-8"; html[subframe] #main-frame-error {
    display: none;
}

html:not([subframe]) #sub-frame-error {
    display: none;
}

h1 {
    margin-top: 0px;
    overflow-wrap: break-word;
}

h1 span {
    font-weight: 500;
}

a {
    text-decoration: none;
}

.icon {
    user-select: none;
    display: inline-block;
}

.icon-generic {
    content: image-set(url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyEEAAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAENJREFUeF7tzbEJACEQRNGBLeAasBCza2lLEGx0CxFGG9hBMDDxRy/72O9FMnIFapGylsu1fgoBdkXfUHLrQgdfrlJN1BdYBjQQm3UAAAAASUVORK5CYII=") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQAQMAAADdiHD7AAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAFJJREFUeF7t0cENgDAMQ9FwYgxG6WjpaIzCCAxQxVggFuDiCvlLOeRdHR9yzjncHVoq3npu+wQUrUuJHylSTmBaespJyJQoObUeyxDQb3bEm5Au81c0pSCD8HYAAAAASUVORK5CYII=") 2x);
}

.icon-info {
    content: image-set(url("data:image/png;base64,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") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQCAYAAADnRuK4AAAAAXNSR0IArs4c6QAAEp1JREFUeAHtnVuMFkUWx2dgRlBhvUxQSZTsw25wAUPiNQTRgFkv8YIbZhBcB8hK2NVkXnxRY0xMDFFffJkHsyxskBFRGIJ4iWjioLJqdL3EENFZ35AELxnRHZFFBtjff+gePsbv0qe6+vv6+6Y66XR39alT5/zPv6urq6q7m5rCEhAICAQEAgIBgYBAQCAgEBAICAQEAgIBgYBAQCAgEBAICAQEAgIBgYBAQCAgEBBoTASaG9Ot8l6tWLFi4sGDB3+P1HStx44d0/a85ubmyWwnHz9+fHgbHTdxPEj6IMfD2+j423HjxvWTPryeeeaZX65fv/5/HI+pZUwQ6I477vjD0NDQAgiwgOBfynYa23E+I43OY+jcy/Zjtn0tLS19zz///Oc+y8ijroYkUEdHxxSCuBDAF7DOZ/+CWoAPmb6m3J2sfexv37Jly3e1sCPLMhuGQF1dXRP2799/G2TpBLCbWFuyBM5B9xB5XoVIPVOnTn2xu7v7sIOO3GWpewJR21xJG+ZukF3MenbuEC5u0A8kb6YNtY5a6YPiIvWRWrcEWrx48XyI8xA1znX1AXVxK6mR3oBIqzdv3qxbXd0tdUcgapybIY2IM6fu0C5jMER6j3U1NdIrZcRyd6puCARx5kCabtbLcoeiR4Mg0UesXRDpPY9qM1OVewItW7asjT6bJ0DgL6y5t9dTpI6j55/0Ld2/YcOGAU86M1GT24BQ0zS3t7evxOvHWNsy8T7/SkWeB3t7e9dSK4lUuVtySSBuV9NoID8LWnNzh1htDHqHhvad3Nb21qb40qV67Y0tXUzyMzxd3Urt8wk5AnlOwjZXmAibk0n52MtNDbRq1arWgYGBx4HlvmpAwy3hJ8rpJzD98ZgW+1+RPjh+/PjB0047bfDQoUMa+2o6/fTTJ//yyy+Tjx49OjxOhsxFJA+PobE/PJ5G3kmSrcLyZFtb2wNr1qw5UoWyKhaRCwItWbLkIsaqthCEqypa7CggwqD/bbZ9bPsuueSSTx955JFjjupOyYaecbt3756Nbo21acztGraZEQr97zPW1vHcc899dYohNTioOYFo78ygvfMavl+Ygf8aQe+lhumZMWPGLgKt4YTMF8pp2bNnzzz86oRI7RSo0X3fyz78uoF20R7fii36akqgqG/nZUA+12J0JVlI8zrr08htA+BDleSzPM+t+YwDBw7cjo/LWa/3WRY+fs96Sy37jGpGIMhzM1foZgA9wweoAKnb0VbaL6uZRvGpD52+dTCtZDbtqIfQuwgy+XqA+ZmaaDEkqkkPdk0IRP/OnwFwPUCmHjGPiPNMa2vrY5s2bfrCd9Cz0Ld06dKLjxw58iC67/JEpCFItBwSqeujqkvVCRTVPC/gpQ/yfEgA7tm6deuHVUXNU2GLFi26nAvgKXy43INKkej2atdEvqrRRP6rzRPdtlKRB9APANa9s2bNuqpeySPAZLt8kC/yKRGIpYVahK0wLi3i/0zVaiAcm8GVtos1VYMZoHfQL7O8p6fnW/9w1E5jZ2fnefQ7PQ0+N6axAnzUsJ5HTVSVp7OqEEj9PNzz3wWYNI/qqqIfZt7MEwCUy3GhNIFXXsjTTG/z/dQkj3KYppbeN3HixDkbN27cl9amSvkzv4Wph1mdhBiShjzq85jPVfV4o5JHgZJv8lG+cpgm+BcePny4V9hLb5ZL5gTS8ARXVpoe5k8B9AqA/VeWQORJt3yVz9jk3B0hzKOhoUxdy/QWpsE/+j1edPWAK/It1oUA+qOrjnrOR7vxLIiwnfVaVz/oF7uN2/5Lrvkr5cusBsL5adzL11cyoNR5iLNt0qRJN45V8ggX+S4MhEUpnCqlKwaKRSU51/OZEIgrphnDn2Xr9MQlwFg7xuKbnqMDKQyEhSuJFIMoFpncbTIhUDST0Gk+D0C9xVWnyVNHR4M5Vo+FhTARNo4YzI1i4pi9dDbvrIzmMPdTpMs0VDWYrx3Lt63SoWpqUpuI2kQkml1OrsS5AeZYT/c9x9p7DRRNgHchjx7Vx3Sbp0TgR5J1YQkjElwe8eOXE0b0+djxWgNxhWio4h0Ms+pVJ6H6eWr2qM64lKlzkmEIq48+4jWsA5yvBuedHLQYlR4H57ng7O2VIa81EA22bhwyA4tTD9eSPMYg1FxcWAkzB0Oaoxg5ZC2exRuBuCr0xuhlxYspnUrDcIeGJ0pLhDPFEIiGdHYUO1cuTTFSrMrJWM55IxCGaaKUaYE8BzQwytZ0+zAV0qDCwizCzjyK7xKrUjB6IRA9zvoGj3kaASA81Gij6qWAziJd2AlDq27FSjGz5ism74VANOjMTuD4hzNnzvx7MaNCWnIEhKGwTJ7jhKRLzIqVkZpA3E+vhNGmT6zgsD4Hd4+v12qKOTZW0oShsBSmFp8VM8XOkqeYbGoCYcjKYoorpD1TzzMJK/hW9dMRls9YC3aM3SnFpCKQPiuHER2naKxwoCtFE+AriIXTRgSEqUMt1KEYGos6RTwVgfRNQrRZPyu3tV7enjgFqZwfRJhuNZp5dhRDY7aT4qkIhJplJ1Ul29N7W8kkg5QVARdsuYPoo6TOizOBaIDpU7qmCeBUsa/n9aU/ZwRzlFHYCmOjSTcplsY8I+LWsZSRjJBnIQem/Dj39IiCnO3UcmzLJxTCmNhYXqFuiWK51sUO5xqIwhYYCxxE3nlmnbGssSwujIW1ZbHGckR3GgKZejK5MnoZBKzphw5GvG7gHWEsrI0ummJZqNuJQNwz9ZKg6fcBjB73FBYc9rNDwIq1Yqn/ibhY5EQgusFNjOWK+Enf53ExMOSxIyCshbklp35GY5GPZZ0IhHGmwmD429X6uFPs2FjeCmthbsHAGtNYtxOBMO7SWEGSLcb1JZELMv4QsGJujWlsqZlA+lkbxpneM8K4QKAY8SptrZgrpoqt1TwzgfSnP4xLnA/DftIHLa2GBfl0CAhzYZ9Ui2Ia/cUxaZZhucREKNCqz9palv4wbcMClx/ZCHO9XmVZrLFtypxAMNvqhMXhIFsGAQfssycQj/CmQuiTCAQqE+QsT1mxt8ZWtpvGspSB++r5MFu7SZe6IFA9vReWFHjkTNgrtgbdw6IutzDTR7Mh21dWo4K8HwQcsDfFVla6EMj0CX9YbR3Y84Ne0KK7hRV7U2ydCASrTSxlkpPViRB6TwhYsbfG1olAZDIRSH+98YRHUGNEwAF7U2xljvkWRrVoKiT+ZZLR9yDuAQEr9tbYykQzgTz4FVQ0EAJmAnGfNN2S9LO2BsKrrlyxYm+NrcAwE4g8JgLpT391hXoDGeuAvSm2gspMIOujoX4T2UAxqStXrNhbY+tEIDKZWOryaFhXUcqxsQ7Ym2LrSqDEUwRUAKzWD2rDUgMErNhXpQ1EId8YsTANvhp1B/HyCFixN/8BydwGqsYIb3lMwtmkCFhH162xlR1mApHHOsJrvQqS4hPkKiDALcyKvSm2Kj5zAlHGdGbHuZRTAZ5wuhwCEeb5IxBfO/8SZh8rZ3zhOdpMk3bv3j27MC3sZ4+AMBf2SUtSTBXbpPKxnLlm0M8/MGxvrCDJFuMWJJELMv4QsGKumLr83MZMILmIcR9bXMW4QCALYB5krZhbYxqb6EQgjDO954Vx13BPNk+fjY0MWxsCwlqYW3JZYxrrdiJQS0uLiUAYN2nPnj3z4kLDNlsEhLUwt5RijWms24lAfAnrcxj+dawkyZY+iVSfUktSRpA5gYAVa8VSMXXBz4lAUUH6W0zihSuinc/CnJ44QxB0QkAYC2tjZlMsC3WnIZDpNkahGpX/U2HhYT8TBISxdQaENZYjhjsTiGpvO1qGRjQl2OHKWJ5ALIikQACMVxizD0WxNGY7Ie5MID6l9h0qXrWUinPX8yWs0KloAc0gK2zB+I+GLBJ9NYqlMdsJcWcCKTvMNX+2jklO5h+zOHk2BjO5YOsSw0JoUxFo6tSpL6Lsh0KFCfYXLV269OIEckHEgECE6SJDFon+EMXQmO2keCoCdXd3H0bV5pPqKu9RxY47cuTIg5Ulg4QFAWEqbC15kN0cxdCY7aS4tcCTOaM95pCs+1Vi5YS7+JjB5ZXFgkQSBCIs70oiWyjjGLtCFU7TOU5RQAPsA+6jb5ySWOFAVwp5ngrTPCoAleC0MBSW1tpHMVPsEhRRViR1DSTtMNn8AxUcvvyzzz77a1nrwsmKCAhDYVlRcJSAS8xGqRg+9EIg/iC8E0a/V6yAcmk4vrqzs/O8cjLhXGkEhJ0wLC1R/IxipZgVP2tL9UIgFYlRZkdw/hze39bPQZptZgdpYRZhd44VDZdYlSrDG4G4n76CYR+VKqhUOkDcyB+E7y91PqQXR0CYCbviZ0unKkaKVWkJ2xlvBFKxGNfF5rjNhKYmRo8fZRDwamu+sSovrISZg//Hoxg5ZC2exfutg0fKtRR1d/Hiyqbuo2F3BVeHaZpIWY0NeBLyXAB5/o1rFzq4t47/oq10yFcyi9caSKUwMVu3o4GSJZY+cSHA7ACgs0qLjO0zwkYYgYILeQai2HgF0TuBNmzYIPK49jRrMHC7yyf3vaKSQ2XCRNhgmutg9INRbLx65/0WJutwtLm9vX0Xu3NdrOU+vY21g9vZUZf8jZaHmmc8mG5h1Vwfl+Wd3t7eeWBqbp9WKsx7DaQCZSjtmTvZfl/JgGLnBZQACzVRU1NU8ziTRzGIYuGdPMOxLhZAX2k8at7KFAON2DstOP8W60Jqoh+dFNR5JrV5uJC2s17r6gpfar2NTsOXXPNXyje+kkCa83Sz/4e/5/0GHXMc9fwW8G6aNWvWC7xpYPqsjGN5uckGefS0pTHGq1IY9SS3ru4U+StmzeQWVlhqW1vbA9Qi7xemGfdn67EVQMdMP5F8lc/g5NpgVjPifWFvxNosnkkjerQVS5YsuYj5Ku+S7vL4Gasb4l7+MNXxE4CTyf08LqhWW2rbZvUwQx51EqZ5EXPfxIkT52zcuHFf1r5UhUBygqtKf3rexXpuGqcgzw6+Prq8p6fH/DGkNOVmnVcDo9HYlnl4otA28PmedR7txj2F6VntZ9oGKjSaNsx3M2fOFIGWkt5aeM64/zv+MLwSXf/lav34zTffrOvaSPN5pkyZ8jdq6G1gc4kRi9HiP1NL3wh5Phl9IqvjqtVAsQPURDdTRb/AcZoqOlandsK9dM9/GCfU01YzCaktNBnMPJ+niJ+6xd8OebwNlBYp41dJVSeQLIBEd0Kip9lNTSICcAw9z7S2tj62adOmL6Q/74smwEfzwu+CPD4eZESe5ZDn2Wr7XhMCycmoJtKE/DN8OB0RaSv9Hqt5z/tTHzp969B7W9GrN4s8EUcm6ra1uNo1T4xNzQgkAyDRHIB8mTVVwzp2Jt5CptdZVcNtA9hDcXottvio7wGoZ3056/U+bcBHNZhvwUfzbFBfdtSUQHICgGdwO3uN3TSP+KXwGATgXq7QHjo0d9FgHSol6DOdclr0iRX86oQ07eie7FN/pEvTX26APFV52iplf80JJMPUT8STlcZ70vS6lvJxOB0i/YT+t9n2se3Tf9UJtNpPqRc9SembhOhegO4FbK9ha/o+j8UI9L8/YcKE9mr081SyKxcEkpGrVq1qHRgYeJzd+yoZ7eM8QdDQSD+B7udK7o/2vyJ9UH/608/a4v9t6a83+nEJ7ZfJyE9G5iLkp1PDTGdfX0KdniVh0F+4PKke5jVr1hwpTKzVfm4IFAOgAVgCs56AeG0XxfrrdQtRNaq+IsuBURdsckcgOUG7aBok0iOp03wiFyBynucdyHMn7Z29ebMzlwQSSNRAmpS2kt3HWNuUNgaX4dmdjKivpQbKZY+7j06sTOIqwOhh/gfzeNXGWMeaSwAzcf6Er+vkuzDIK3nke25roNGBifqMuqmZLht9rpGOIctHrF217Nux4Fk3BIqdgkg3Q6KHWF0nqcWqcrWFNO+xroY4VR3LSgtC3REodpintfk0tEWk6+K0etxCmjdoIK/29a56tTGoWwLFQFEjXQmJVrJ2kHZ2nJ7z7Q8QZwvrWmqc1J9YqaWvdU+gGLyurq4J+/fvv43jZZBJk7JSj/THuj1t9TVUvRS4QZ+VS/tlME82pVbTMAQqRIJaaQokWkjaAtb57F9QeL5a+xBGr2nvZO1jfzu1jb5s21BLQxJodIQglAZs5xNEjVVdynYaW69dGOg8hs69bD9m20e7ZieEqelA52gcsjgeEwQaDZxe1jt48ODvSR8ex4JcGtM6n2ONmk+CANpqzGt4FJ3jQY41sq+txtAGSfsGkgyPoXHcT5/Nly7/2yJvWAICAYGAQEAgIBAQCAgEBAICAYGAQEAgIBAQCAgEBAICAYGAQEAgIBAQCAgEBAICAYEcIvB/Q079+h6myXwAAAAASUVORK5CYII=") 2x);
}

.icon-offline {
    content: image-set(url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyEEAAAABlBMVEUAAABTU1OoaSf/AAAAAXRSTlMAQObYZgAAAGxJREFUeF7tyMEJwkAQRuFf5ipMKxYQiJ3Z2nSwrWwBA0+DQZcdxEOueaePp9+dQZFB7GpUcURSVU66yVNFj6LFICatThZB6r/ko/pbRpUgilY0Cbw5sNmb9txGXUKyuH7eV25x39DtJXUNPQGJtWFV+BT/QAAAAABJRU5ErkJggg==") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQBAMAAAAVaP+LAAAAGFBMVEUAAABTU1NNTU1TU1NPT09SUlJSUlJTU1O8B7DEAAAAB3RSTlMAoArVKvVgBuEdKgAAAJ1JREFUeF7t1TEOwyAMQNG0Q6/UE+RMXD9d/tC6womIFSL9P+MnAYOXeTIzMzMzMzMzaz8J9Ri6HoITmuHXhISE8nEh9yxDh55aCEUoTGbbQwjqHwIkRAEiIaG0+0AA9VBMaE89Rogeoww936MQrWdBr4GN/z0IAdQ6nQ/FIpRXDwHcA+JIJcQowQAlFUA0MfQpXLlVQfkzR4igS6ENjknm/wiaGhsAAAAASUVORK5CYII=") 2x);
    position: relative;
}

.icon-disabled {
    content: image-set(url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABICAMAAAAZF4G5AAAABlBMVEVMaXFTU1OXUj8tAAAAAXRSTlMAQObYZgAAASZJREFUeAHd11Fq7jAMRGGf/W/6PoWB67YMqv5DybwG/CFjRuR8JBw3+ByiRjgV9W/TJ31P0tBfC6+cj1haUFXKHmVJo5wP98WwQ0ZCbfUc6LQ6VuUBz31ikADkLMkDrfUC4rR6QGW+gF6rx7NaHWCj1Y/W6lf4L7utvgBSt3rBFSS/XBMPUILcJINHCBWYUfpWn4NBi1ZfudIc3rf6/NGEvEA+AsYTJozmXemjXeLZAov+mnkN2HfzXpMSVQDnGw++57qNJ4D1xitA2sJ+VAWMygSEaYf2mYPTjZfk2K8wmP7HLIH5Mg4/pP+PEcDzUvDMvYbs/2NWwPO5vBdMZE4EE5UTQLiBFDaUlTDPBRoJ9HdAYIkIo06og3BNXtCzy7zA1aXk5x+tJARq63eAygAAAABJRU5ErkJggg==") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOAAAACQAQMAAAArwfVjAAAABlBMVEVMaXFTU1OXUj8tAAAAAXRSTlMAQObYZgAAAYdJREFUeF7F1EFqwzAUBNARAmVj0FZe5QoBH6BX+dn4GlY2PYNzGx/A0CvkCIJuvIraKJKbgBvzf2g62weDGD7CYggpfFReis4J0ey9EGFIiEQQojFSlA9kSIiqd0KkFjKsewgRbStEN19mxUPTtmW9HQ/h6tyqNQ8NlSMZdzyE6qkoE0trVYGFm0n1WYeBhduzwbwBC7voS+vIxfeMjeaiLxsMMtQNwMPtuew+DjzcTHk8YMfDknEcIUOtf2lVfgVH3K4Xv5PRYAXRVMtItIJ3rfaCIVn9DsTH2NxisAVRex2Hh3hX+/mRUR08bAwPEYsI51ZxWH4Q0SpicQRXeyEaIug48FEdegARfMz/tADVsRciwTAxW308ehmC2gLraC+YCbV3QoTZexa+zegAEW5PhhgYfmbvJgcRqngGByOSXdFJcLk2JeDPEN0kxe1JhIt5FiFA+w+ItMELsUyPF2IaJ4aILqb4FbxPwhImwj6JauKgDUCYaxmYIsd4KXdMjIC9ItB5Bn4BNRwsG0XM2nwAAAAASUVORK5CYII=") 2x);
    width: 112px;
}

.hidden {
    display: none;
}

#suggestions-list a {
    color: var(--google-blue-600);
}

#suggestions-list p {
    margin-block-end: 0px; }

#suggestions-list ul {
    margin-top: 0px;
}

.single-suggestion {
    list-style-type: none;
    padding-inline-start: 0px; }

#error-information-button {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJub25lIiBkPSJNMCAwaDI0djI0SDB6Ii8+PHBhdGggZD0iTTExIDE4aDJ2LTJoLTJ2MnptMS0xNkM2LjQ4IDIgMiA2LjQ4IDIgMTJzNC40OCAxMCAxMCAxMCAxMC00LjQ4IDEwLTEwUzE3LjUyIDIgMTIgMnptMCAxOGMtNC40MSAwLTgtMy41OS04LThzMy41OS04IDgtOCA4IDMuNTkgOCA4LTMuNTkgOC04IDh6bTAtMTRjLTIuMjEgMC00IDEuNzktNCA0aDJjMC0xLjEuOS0yIDItMnMyIC45IDIgMmMwIDItMyAxLjc1LTMgNWgyYzAtMi4yNSAzLTIuNSAzLTUgMC0yLjIxLTEuNzktNC00LTR6Ii8+PC9zdmc+");
    height: 24px;
    vertical-align: -0.15em;
    width: 24px;
}

.use-popup-container#error-information-popup-container #error-information-popup {
    align-items: center;
    background-color: var(--popup-container-background-color);
    display: flex;
    height: 100%;
    left: 0px;
    position: fixed;
    top: 0px;
    width: 100%;
    z-index: 100;
}

.use-popup-container#error-information-popup-container #error-information-popup-content > p {
    margin-bottom: 11px;
    margin-inline-start: 20px; }

.use-popup-container#error-information-popup-container #suggestions-list ul {
    margin-inline-start: 15px; }

.use-popup-container#error-information-popup-container #error-information-popup-box {
    background-color: var(--background-color);
    left: 5%;
    padding-bottom: 15px;
    padding-top: 15px;
    position: fixed;
    width: 90%;
    z-index: 101;
}

.use-popup-container#error-information-popup-container div.error-code {
    margin-inline-start: 20px; }

.use-popup-container#error-information-popup-container #suggestions-list p {
    margin-inline-start: 20px; }

:not(.use-popup-container)#error-information-popup-container #error-information-popup-close {
    display: none;
}

#error-information-popup-close {
    margin-bottom: 0px;
    margin-inline-end: 35px; margin-top: 15px;
    text-align: end;
}

.link-button {
    color: rgb(66, 133, 244);
    display: inline-block;
    font-weight: bold;
    text-transform: uppercase;
}

#sub-frame-error-details {
    color: rgb(143, 143, 143);
    text-shadow: rgba(255, 255, 255, 0.3) 0px 1px 0px;
}

[jscontent="hostName"], [jscontent="failedUrl"] {
    overflow-wrap: break-word;
}

.secondary-button {
    background: rgb(217, 217, 217);
    color: rgb(105, 105, 105);
    margin-inline-end: 16px; }

.snackbar {
    background: rgb(50, 50, 50);
    border-radius: 2px;
    bottom: 24px;
    box-sizing: border-box;
    color: rgb(255, 255, 255);
    font-size: 0.87em;
    left: 24px;
    max-width: 568px;
    min-width: 288px;
    opacity: 0;
    padding: 16px 24px 12px;
    position: fixed;
    transform: translateY(90px);
    will-change: opacity, transform;
    z-index: 999;
}

.snackbar-show {
    animation: 250ms cubic-bezier(0, 0, 0.2, 1) 0s 1 normal forwards running show-snackbar, 250ms cubic-bezier(0.4, 0, 1, 1) 5s 1 normal forwards running hide-snackbar;
}

@-webkit-keyframes show-snackbar {
    100% {
        opacity: 1;
        transform: translateY(0px);
    }
}

@-webkit-keyframes hide-snackbar {
    0% {
        opacity: 1;
        transform: translateY(0px);
    }

    100% {
        opacity: 0;
        transform: translateY(90px);
    }
}

.suggestions {
    margin-top: 18px;
}

.suggestion-header {
    font-weight: bold;
    margin-bottom: 4px;
}

.suggestion-body {
    color: rgb(119, 119, 119);
}

@media (max-width: 640px), (max-height: 640px) {
    h1 {
        margin: 0px 0px 15px;
    }

    .suggestions {
        margin-top: 10px;
    }

    .suggestion-header {
        margin-bottom: 0px;
    }
}

#download-link, #download-link-clicked {
    margin-bottom: 30px;
    margin-top: 30px;
}

#download-link-clicked {
    color: rgb(187, 187, 187);
}

#download-link::before, #download-link-clicked::before {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxLjJlbSIgaGVpZ2h0PSIxLjJlbSIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNNSAyMGgxNHYtMkg1bTE0LTloLTRWM0g5djZINWw3IDcgNy03eiIgZmlsbD0iIzQyODVGNCIvPjwvc3ZnPg==");
    display: inline-block;
    margin-inline-end: 4px; vertical-align: -webkit-baseline-middle;
}

#download-link-clicked::before {
    opacity: 0;
    width: 0px;
}

#offline-content-list-visibility-card {
    border: 1px solid white;
    border-radius: 8px;
    display: flex;
    font-size: 0.8em;
    justify-content: space-between;
    line-height: 1;
}

#offline-content-list.list-hidden #offline-content-list-visibility-card {
    border-color: rgb(218, 220, 224);
}

#offline-content-list-visibility-card > div {
    padding: 1em;
}

#offline-content-list-title {
    color: var(--google-gray-700);
}

#offline-content-list-show-text, #offline-content-list-hide-text {
    color: rgb(66, 133, 244);
}

#offline-content-list.list-hidden #offline-content-list-hide-text, #offline-content-list:not(.list-hidden) #offline-content-list-show-text {
    display: none;
}

#offline-content-suggestions {
    max-height: 27em;
    transition: max-height 200ms ease-in, visibility 200ms, opacity 200ms linear 200ms;
}

#offline-content-list.list-hidden #offline-content-suggestions {
    max-height: 0px;
    opacity: 0;
    transition: opacity 200ms linear, visibility 200ms, max-height 200ms ease-out 200ms;
    visibility: hidden;
}

#offline-content-list {
    margin-inline-start: -5%; width: 110%;
}

@media (max-width: 420px) {
    #offline-content-list {
        margin-inline-start: -2.5%;
        width: 105%;
    }
}

@media (max-width: 420px) and (orientation: portrait), (max-height: 560px) {
    #offline-content-list {
        margin-inline-start: -12px;
        width: calc(100% + 24px);
    }
}

.suggestion-with-image .offline-content-suggestion-thumbnail {
    flex-basis: 8.2em;
    flex-shrink: 0;
}

.suggestion-with-image .offline-content-suggestion-thumbnail > img {
    height: 100%;
    width: 100%;
}

.suggestion-with-image #offline-content-list:not(.is-rtl) .offline-content-suggestion-thumbnail > img {
    border-bottom-right-radius: 7px;
    border-top-right-radius: 7px;
}

.suggestion-with-image #offline-content-list.is-rtl .offline-content-suggestion-thumbnail > img {
    border-bottom-left-radius: 7px;
    border-top-left-radius: 7px;
}

.suggestion-with-icon .offline-content-suggestion-thumbnail {
    align-items: center;
    display: flex;
    justify-content: center;
    min-height: 4.2em;
    min-width: 4.2em;
}

.suggestion-with-icon .offline-content-suggestion-thumbnail > div {
    align-items: center;
    background-color: rgb(241, 243, 244);
    border-radius: 50%;
    display: flex;
    height: 2.3em;
    justify-content: center;
    width: 2.3em;
}

.suggestion-with-icon .offline-content-suggestion-thumbnail > div > img {
    height: 1.45em;
    width: 1.45em;
}

.offline-content-suggestion-favicon {
    height: 1em;
    margin-inline-end: 0.4em; width: 1.4em;
}

.offline-content-suggestion-favicon > img {
    height: 1.4em;
    width: 1.4em;
}

.no-favicon .offline-content-suggestion-favicon {
    display: none;
}

.image-video {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNMTcgMTAuNVY3YTEgMSAwIDAgMC0xLTFINGExIDEgMCAwIDAtMSAxdjEwYTEgMSAwIDAgMCAxIDFoMTJhMSAxIDAgMCAwIDEtMXYtMy41bDQgNHYtMTFsLTQgNHoiIGZpbGw9IiMzQzQwNDMiLz48L3N2Zz4=");
}

.image-music-note {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNMTIgM3Y5LjI2Yy0uNS0uMTctMS0uMjYtMS41LS4yNkM4IDEyIDYgMTQgNiAxNi41UzggMjEgMTAuNSAyMXM0LjUtMiA0LjUtNC41VjZoNFYzaC03eiIgZmlsbD0iIzNDNDA0MyIvPjwvc3ZnPg==");
}

.image-earth {
    content: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMmM1LjUyIDAgMTAgNC40OCAxMCAxMHMtNC40OCAxMC0xMCAxMFMyIDE3LjUyIDIgMTIgNi40OCAyIDEyIDJ6TTQgMTJoNC40YzMuNDA3LjAyMiA0LjkyMiAxLjczIDQuNTQzIDUuMTI3SDkuNDg4djIuNDdhOC4wMDQgOC4wMDQgMCAwIDAgMTAuNDk4LTguMDgzQzE5LjMyNyAxMi41MDQgMTguMzMyIDEzIDE3IDEzYy0yLjEzNyAwLTMuMjA2LS45MTYtMy4yMDYtMi43NWgtMy43NDhjLS4yNzQtMi43MjguNjgzLTQuMDkyIDIuODctNC4wOTIgMC0uOTc1LjMyNy0xLjU5Ny44MTEtMS45N0E4LjAwNCA4LjAwNCAwIDAgMCA0IDEyeiIgZmlsbD0iIzNDNDA0MyIvPjwvc3ZnPg==");
}

.image-file {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNMTMgOVYzLjVMMTguNSA5TTYgMmMtMS4xMSAwLTIgLjg5LTIgMnYxNmEyIDIgMCAwIDAgMiAyaDEyYTIgMiAwIDAgMCAyLTJWOGwtNi02SDZ6IiBmaWxsPSIjM0M0MDQzIi8+PC9zdmc+");
}

.offline-content-suggestion-texts {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    line-height: 1.3;
    padding: 0.9em;
    width: 100%;
}

.offline-content-suggestion-title {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    color: rgb(32, 33, 36);
    display: -webkit-box;
    font-size: 1.1em;
    overflow: hidden;
    text-overflow: ellipsis;
}

div.offline-content-suggestion {
    align-items: stretch;
    border: 1px solid rgb(218, 220, 224);
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.8em;
}

.suggestion-with-image {
    flex-direction: row;
    height: 8.2em;
    max-height: 8.2em;
}

.suggestion-with-icon {
    flex-direction: row-reverse;
    height: 4.2em;
    max-height: 4.2em;
}

.suggestion-with-icon .offline-content-suggestion-title {
    -webkit-line-clamp: 1;
    word-break: break-all;
}

.suggestion-with-icon .offline-content-suggestion-texts {
    padding-inline-start: 0px; }

.offline-content-suggestion-attribution-freshness {
    color: rgb(95, 99, 104);
    display: flex;
    font-size: 0.8em;
    line-height: 1.7em;
}

.offline-content-suggestion-attribution {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    display: -webkit-box;
    flex-shrink: 1;
    margin-inline-end: 0.3em; overflow: hidden;
    overflow-wrap: break-word;
    text-overflow: ellipsis;
    word-break: break-all;
}

.no-attribution .offline-content-suggestion-attribution {
    display: none;
}

.offline-content-suggestion-freshness::before {
    content: "-";
    display: inline-block;
    flex-shrink: 0;
    margin-inline: 0.1em; }

.no-attribution .offline-content-suggestion-freshness::before {
    display: none;
}

.offline-content-suggestion-freshness {
    flex-shrink: 0;
}

.suggestion-with-image .offline-content-suggestion-pin-spacer {
    flex-grow: 100;
    flex-shrink: 1;
}

.suggestion-with-image .offline-content-suggestion-pin {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PGRlZnM+PHBhdGggaWQ9ImEiIGQ9Ik0wIDBoMjR2MjRIMFYweiIvPjwvZGVmcz48Y2xpcFBhdGggaWQ9ImIiPjx1c2UgeGxpbms6aHJlZj0iI2EiIG92ZXJmbG93PSJ2aXNpYmxlIi8+PC9jbGlwUGF0aD48cGF0aCBjbGlwLXBhdGg9InVybCgjYikiIGQ9Ik0xMiAyQzYuNSAyIDIgNi41IDIgMTJzNC41IDEwIDEwIDEwIDEwLTQuNSAxMC0xMFMxNy41IDIgMTIgMnptNSAxNkg3di0yaDEwdjJ6bS02LjctNEw3IDEwLjdsMS40LTEuNCAxLjkgMS45IDUuMy01LjNMMTcgNy4zIDEwLjMgMTR6IiBmaWxsPSIjOUFBMEE2Ii8+PC9zdmc+");
    flex-shrink: 0;
    height: 1.4em;
    margin-inline-start: 0.4em; width: 1.4em;
}

#offline-content-list-action {
    text-align: center;
    transition: visibility 200ms, opacity 200ms linear 200ms;
}

#offline-content-list.list-hidden #offline-content-list-action {
    opacity: 0;
    transition: opacity 200ms linear, visibility 200ms;
    visibility: hidden;
}

#cancel-save-page-button {
    background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48Y2xpcFBhdGggaWQ9Im1hc2siPjxwYXRoIGQ9Ik0xMiAyQzYuNSAyIDIgNi41IDIgMTJzNC41IDEwIDEwIDEwIDEwLTQuNSAxMC0xMFMxNy41IDIgMTIgMnptNSAxNkg3di0yaDEwdjJ6bS02LjctNEw3IDEwLjdsMS40LTEuNCAxLjkgMS45IDUuMy01LjNMMTcgNy4zIDEwLjMgMTR6IiBmaWxsPSIjOUFBMEE2Ii8+PC9jbGlwUGF0aD48cGF0aCBjbGlwLXBhdGg9InVybCgjbWFzaykiIGZpbGw9IiM5QUEwQTYiIGQ9Ik0wIDBoMjR2MjRIMHoiLz48cGF0aCBjbGlwLXBhdGg9InVybCgjbWFzaykiIGZpbGw9IiMxQTczRTgiIHN0eWxlPSJhbmltYXRpb246b2ZmbGluZUFuaW1hdGlvbiA0cyBpbmZpbml0ZSIgZD0iTTAgMGgyNHYyNEgweiIvPjxzdHlsZT5Aa2V5ZnJhbWVzIG9mZmxpbmVBbmltYXRpb257MCUsMzUle2hlaWdodDowfTYwJXtoZWlnaHQ6MTAwJX05MCV7ZmlsbC1vcGFjaXR5OjF9dG97ZmlsbC1vcGFjaXR5OjB9fTwvc3R5bGU+PC9zdmc+");
    background-position: right 27px center;
    background-repeat: no-repeat;
    border: 1px solid var(--google-gray-300);
    border-radius: 5px;
    color: var(--google-gray-700);
    margin-bottom: 26px;
    padding-bottom: 16px;
    padding-inline: 16px 88px; padding-top: 16px;
    text-align: start;
}

html[dir="rtl"] #cancel-save-page-button {
    background-position: left 27px center;
}

#save-page-for-later-button {
    display: flex;
    justify-content: start;
}

#save-page-for-later-button a::before {
    content: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxLjJlbSIgaGVpZ2h0PSIxLjJlbSIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNNSAyMGgxNHYtMkg1bTE0LTloLTRWM0g5djZINWw3IDcgNy03eiIgZmlsbD0iIzQyODVGNCIvPjwvc3ZnPg==");
    display: inline-block;
    margin-inline-end: 4px; vertical-align: -webkit-baseline-middle;
}

.hidden#save-page-for-later-button {
    display: none;
}

html[subframe] body {
    overflow: hidden;
}

#sub-frame-error {
    align-items: center;
    flex-flow: column;
    justify-content: center;
    background-color: rgb(221, 221, 221);
    display: -webkit-flex;
    height: 100%;
    left: 0px;
    position: absolute;
    text-align: center;
    top: 0px;
    transition: background-color 200ms ease-in-out;
    width: 100%;
}

#sub-frame-error:hover {
    background-color: rgb(238, 238, 238);
}

#sub-frame-error .icon-generic {
    margin: 0px 0px 16px;
}

#sub-frame-error-details {
    margin: 0px 10px;
    text-align: center;
    opacity: 0;
}

#sub-frame-error:hover #sub-frame-error-details {
    opacity: 1;
}

@media (max-width: 200px), (max-height: 95px) {
    #sub-frame-error-details {
        display: none;
    }
}

@media (max-height: 100px) {
    #sub-frame-error .icon-generic {
        height: auto;
        margin: 0px;
        padding-top: 0px;
        width: 25px;
    }
}

#details-button {
    box-shadow: none;
    min-width: 0px;
}

.suggested-left > #control-buttons, .suggested-right > #details-button {
    float: left;
}

.suggested-right > #control-buttons, .suggested-left > #details-button {
    float: right;
}

.suggested-left .secondary-button {
    margin-inline: 16px 0px; }

#details-button.singular {
    float: none;
}

#download-button {
    padding-bottom: 4px;
    padding-top: 4px;
    position: relative;
}

#download-button::before {
    background: image-set(url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAAAO0lEQVQ4y2NgGArgPxIY1YChsOE/LtBAmpYG0mxpIOSDBpKUo2lpIDZxNJCkHKqlYZAla3RAHQ1DFgAARRroHyLNTwwAAAAASUVORK5CYII=") 1x, url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAQAAAD9CzEMAAAAZElEQVRYw+3Ruw3AMAwDUY3OzZUmRRD4E9iim9wNwAdbEURHyk4AAAAATiCVK8lLyPsKeT9K3lsownnunfkPxO78hKiYHxBV8x2icr5BVM+/CMf8g3DN34Rzns6ViwHUAUQ/6wIAd5Km7l6c8AAAAABJRU5ErkJggg==") 2x) no-repeat;
    content: "";
    display: inline-block;
    height: 24px;
    margin-inline: -4px 4px; vertical-align: middle;
    width: 24px;
}

#download-button:disabled {
    background: rgb(180, 206, 249);
    color: rgb(255, 255, 255);
}

#buttons::after {
    clear: both;
    content: "";
    display: block;
    width: 100%;
}

html[dir="rtl"] .runner-container, html[dir="rtl"].offline .icon-offline {
    transform: scaleX(-1);
}

.offline {
    transition: filter 1.5s cubic-bezier(0.65, 0.05, 0.36, 1), background-color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
    will-change: filter, background-color;
}

.offline body {
    transition: background-color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
}

.offline #main-message > p {
    display: none;
}

.offline.inverted {
    background-color: rgb(255, 255, 255);
    filter: invert(1);
}

.offline.inverted body {
    background-color: rgb(255, 255, 255);
}

.offline .interstitial-wrapper {
    color: var(--text-color);
    font-size: 1em;
    line-height: 1.55;
    margin: 0px auto;
    max-width: 600px;
    padding-top: 100px;
    position: relative;
    width: 100%;
}

.offline .runner-container {
    direction: ltr;
    height: 150px;
    max-width: 600px;
    overflow: hidden;
    position: absolute;
    top: 35px;
    width: 44px;
}

.offline .runner-container:focus {
    outline: none;
}

.offline .runner-container:focus-visible {
    outline: 3px solid var(--google-blue-300);
}

.offline .runner-canvas {
    height: 150px;
    max-width: 600px;
    opacity: 1;
    overflow: hidden;
    position: absolute;
    top: 0px;
    z-index: 10;
}

.offline .controller {
    height: 100vh;
    left: 0px;
    position: absolute;
    top: 0px;
    width: 100vw;
    z-index: 9;
}

#offline-resources {
    display: none;
}

#offline-instruction {
    image-rendering: pixelated;
    left: 0px;
    margin: auto;
    position: absolute;
    right: 0px;
    top: 60px;
    width: fit-content;
}

.offline-runner-live-region {
    bottom: 0px;
    clip-path: polygon(0px 0px, 0px 0px, 0px 0px);
    color: var(--background-color);
    display: block;
    font-size: xx-small;
    overflow: hidden;
    position: absolute;
    text-align: center;
    transition: color 1.5s cubic-bezier(0.65, 0.05, 0.36, 1);
    user-select: none;
}

.slow-speed-option {
    align-items: center;
    background: var(--google-gray-50);
    border-radius: 24px / 50%;
    bottom: 0px;
    color: var(--error-code-color);
    display: inline-flex;
    font-size: 1em;
    left: 0px;
    line-height: 1.1em;
    margin: 5px auto;
    padding: 2px 12px 3px 20px;
    position: absolute;
    right: 0px;
    width: max-content;
    z-index: 999;
}

.slow-speed-option.hidden {
    display: none;
}

.slow-speed-option [type="checkbox"] {
    opacity: 0;
    pointer-events: none;
    position: absolute;
}

.slow-speed-option .slow-speed-toggle {
    cursor: pointer;
    margin-inline-start: 8px; padding: 8px 4px;
    position: relative;
}

.slow-speed-option [type="checkbox"]:disabled ~ .slow-speed-toggle {
    cursor: default;
}

.slow-speed-option-label [type="checkbox"] {
    opacity: 0;
    pointer-events: none;
    position: absolute;
}

.slow-speed-option .slow-speed-toggle::before, .slow-speed-option .slow-speed-toggle::after {
    content: "";
    display: block;
    margin: 0px 3px;
    transition: 100ms cubic-bezier(0.4, 0, 1, 1);
}

.slow-speed-option .slow-speed-toggle::before {
    background: rgb(189, 193, 198);
    border-radius: 0.65em;
    height: 0.9em;
    width: 2em;
}

.slow-speed-option .slow-speed-toggle::after {
    background: rgb(255, 255, 255);
    border-radius: 50%;
    box-shadow: rgba(0, 0, 0, 0.4) 0px 1px 3px 0px;
    height: 1.2em;
    position: absolute;
    top: 51%;
    transform: translate(-20%, -50%);
    width: 1.1em;
}

.slow-speed-option [type="checkbox"]:focus + .slow-speed-toggle {
    box-shadow: rgb(94, 158, 214) 0px 0px 8px;
    outline: rgb(93, 157, 213) solid 1px;
}

.slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::before {
    background: var(--google-blue-600);
    opacity: 0.5;
}

.slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::after {
    background: var(--google-blue-600);
    transform: translate(calc(-90% + 2em), -50%);
}

.slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::before {
    background: rgb(189, 193, 198);
}

.slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::after {
    background: var(--google-gray-50);
}

@media (max-width: 420px) {
    #download-button {
        padding-bottom: 12px;
        padding-top: 12px;
    }

    .suggested-left > #control-buttons, .suggested-right > #control-buttons {
        float: none;
    }

    .snackbar {
        border-radius: 0px;
        bottom: 0px;
        left: 0px;
        width: 100%;
    }
}

@media (max-height: 350px) {
    h1 {
        margin: 0px 0px 15px;
    }

    .icon-offline {
        margin: 0px 0px 10px;
    }

    .interstitial-wrapper {
        margin-top: 5%;
    }

    .nav-wrapper {
        margin-top: 30px;
    }
}

@media (min-width: 420px) and (max-width: 736px) and (min-height: 240px) and (max-height: 420px) and (orientation: landscape) {
    .interstitial-wrapper {
        margin-bottom: 100px;
    }
}

@media (max-width: 360px) and (max-height: 480px) {
    .offline .interstitial-wrapper {
        padding-top: 60px;
    }

    .offline .runner-container {
        top: 8px;
    }
}

@media (min-height: 240px) and (orientation: landscape) {
    .offline .interstitial-wrapper {
        margin-bottom: 90px;
    }

    .icon-offline {
        margin-bottom: 20px;
    }
}

@media (max-height: 320px) and (orientation: landscape) {
    .icon-offline {
        margin-bottom: 0px;
    }

    .offline .runner-container {
        top: 10px;
    }
}

@media (max-width: 240px) {
    button {
        padding-inline: 12px;
    }

    .interstitial-wrapper {
        overflow: inherit;
        padding: 0px 8px;
    }
}

@media (max-width: 120px) {
    button {
        width: auto;
    }
}

.arcade-mode, .arcade-mode .runner-container, .arcade-mode .runner-canvas {
    image-rendering: pixelated;
    max-width: 100%;
    overflow: hidden;
}

.arcade-mode #buttons, .arcade-mode #main-content {
    opacity: 0;
    overflow: hidden;
}

.arcade-mode .interstitial-wrapper {
    height: 100vh;
    max-width: 100%;
    overflow: hidden;
}

.arcade-mode .runner-container {
    left: 0px;
    margin: auto;
    right: 0px;
    transform-origin: center top;
    transition: transform 250ms cubic-bezier(0.4, 0, 1, 1) 400ms;
    z-index: 2;
}

@media (prefers-color-scheme: dark) {
    .icon {
        filter: invert(1);
    }

    .offline .runner-canvas {
        filter: invert(1);
    }

    .offline.inverted {
        background-color: var(--background-color);
        filter: invert(0);
    }

    .offline.inverted body {
        background-color: rgb(255, 255, 255);
    }

    .offline.inverted .offline-runner-live-region {
        color: rgb(255, 255, 255);
    }

    #suggestions-list a {
        color: var(--link-color);
    }

    #error-information-button {
        filter: invert(0.6);
    }

    .slow-speed-option {
        background: var(--google-gray-800);
        color: var(--google-gray-100);
    }

    .slow-speed-option .slow-speed-toggle::before, .slow-speed-option [type="checkbox"]:checked:disabled + .slow-speed-toggle::before {
        background: rgb(189, 193, 198);
    }

    .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::after, .slow-speed-option [type="checkbox"]:checked + .slow-speed-toggle::before {
        background: var(--google-blue-300);
    }
}

    </style>
  
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#fff">
    <meta name="viewport" content="width=device-width, initial-scale=1.0,
                                   maximum-scale=1.0, user-scalable=no">
    <title>This site can’t be reached</title>
  </head>
  <body class="neterror" style="font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 75%" jstcache="0">
    <div id="main-frame-error" class="interstitial-wrapper" jstcache="0">
      <div id="main-content" jstcache="0">
        <div class="icon icon-generic" jstcache="0"></div>
        <div id="main-message" jstcache="0">
          <h1 jstcache="0">
            <span jsselect="heading" jsvalues=".innerHTML:msg" jstcache="9">This site can’t be reached</span>
            <a id="error-information-button" class="hidden" jstcache="0"></a>
          </h1>
          <p jsselect="summary" jsvalues=".innerHTML:msg" jstcache="1">Check if there is a typo in <span jscontent="hostName" jstcache="22">this address</span>.</p>
          <!--The suggestion list and error code are normally presented inline,
            in which case error-information-popup-* divs have no effect. When
            error-information-popup-container has the use-popup-container class, this
            information is provided in a popup instead.-->
          <div id="error-information-popup-container" jstcache="0">
            <div id="error-information-popup" jstcache="0">
              <div id="error-information-popup-box" jstcache="0">
                <div id="error-information-popup-content" jstcache="0">
                  <div id="suggestions-list" style="" jsdisplay="(suggestionsSummaryList &amp;&amp; suggestionsSummaryList.length)" jstcache="16">
                    <p jsvalues=".innerHTML:suggestionsSummaryListHeader" jstcache="18"></p>
                    <ul jsvalues=".className:suggestionsSummaryList.length == 1 ? 'single-suggestion' : ''" jstcache="19" class="single-suggestion">
                      <li jsselect="suggestionsSummaryList" jsvalues=".innerHTML:summary" jstcache="21" jsinstance="*0">If spelling is correct, <a id="diagnose-link" jstcache="0">try running Windows Network Diagnostics</a>.</li>
                    </ul>
                  </div>
                  <div class="error-code" jscontent="errorCode" jstcache="17">DNS_PROBE_FINISHED_NXDOMAIN</div>
                  <p id="error-information-popup-close" jstcache="0">
                    <a class="link-button" jscontent="closeDescriptionPopup" jstcache="20">null</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div id="download-links-wrapper" class="hidden" jstcache="0">
            <div id="download-link-wrapper" jstcache="0">
              <a id="download-link" class="link-button" jsselect="downloadButton" jscontent="msg" jsvalues=".disabledText:disabledMsg" jstcache="6" style="display: none;">
              </a>
            </div>
            <div id="download-link-clicked-wrapper" class="hidden" jstcache="0">
              <div id="download-link-clicked" class="link-button" jsselect="downloadButton" jscontent="disabledMsg" jstcache="11" style="display: none;">
              </div>
            </div>
          </div>
          <div id="save-page-for-later-button" class="hidden" jstcache="0">
            <a class="link-button" jsselect="savePageLater" jscontent="savePageMsg" jstcache="10" style="display: none;">
            </a>
          </div>
          <div id="cancel-save-page-button" class="hidden" jsselect="savePageLater" jsvalues=".innerHTML:cancelMsg" jstcache="4" style="display: none;">
          </div>
          
        </div>
      </div>
      <div id="buttons" class="nav-wrapper suggested-left" jstcache="0">
        <div id="control-buttons" jstcache="0">
          <button id="reload-button" class="blue-button text-button" jsselect="reloadButton" jsvalues=".url:reloadUrl" jscontent="msg" jstcache="5">Reload</button>
          <button id="download-button" class="blue-button text-button" jsselect="downloadButton" jscontent="msg" jsvalues=".disabledText:disabledMsg" jstcache="6" style="display: none;">
          </button>
        </div>
        <button id="details-button" class="secondary-button text-button small-link" jscontent="details" jsdisplay="(suggestionsDetails &amp;&amp; suggestionsDetails.length > 0) || diagnose" jsvalues=".detailsText:details; .hideDetailsText:hideDetails;" jstcache="2" style="display: none;"></button>
      </div>
      <div id="details" class="hidden" jstcache="0">
        <div class="suggestions" jsselect="suggestionsDetails" jstcache="3" jsinstance="*0" style="display: none;">
          <div class="suggestion-header" jsvalues=".innerHTML:header" jstcache="7"></div>
          <div class="suggestion-body" jsvalues=".innerHTML:body" jstcache="8"></div>
        </div>
      </div>
    </div>
    <div id="sub-frame-error" jstcache="0">
      <!-- Show details when hovering over the icon, in case the details are
           hidden because they're too large. -->
      <div class="icon" jstcache="0"></div>
      <div id="sub-frame-error-details" jsselect="summary" jsvalues=".innerHTML:msg" jstcache="1">Check if there is a typo in <span jscontent="hostName" jstcache="22">this address</span>.</div>
    </div>
  
  </body>
  </html>
  
  `);
});

// Karena kita berada di modul ES, tentukan __dirname secara manual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mendapatkan path absolut untuk file server.json di direktori saat ini
const serverFilePath = path.join(__dirname, 'server.json');

// Fungsi untuk membaca nilai server dari file server.json
function getServer() {
  try {
    const data = fs.readFileSync(serverFilePath, 'utf8');
    const servers = JSON.parse(data);
    // Mengambil server pertama dari array
    return servers[0].server;
  } catch (error) {
    console.error('Error membaca atau parsing server.json:', error);
    return null;
  }
}

// Fungsi untuk melakukan request ke URL dengan parameter server
async function fetchData() {
  const server = getServer();
  if (!server) {
    console.error('Server tidak ditemukan. Pastikan file server.json valid.');
    return;
  }

  const url = `https://robotipos.com/provider-server/?server=${server}`;
  try {
    const response = await axios.get(url);
    console.log(`Response pada ${new Date().toLocaleString()}:`, response.data);
  } catch (error) {
    console.error(`Terjadi kesalahan saat mem-fetch data: ${error.message}`);
  }
}

// Melakukan fetch data segera saat script dijalankan
fetchData();

// Mengatur interval untuk memanggil fetchData setiap 1 menit (60000 ms)
setInterval(fetchData, 60 * 1000);

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
