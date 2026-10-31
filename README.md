# Studio

Editor blog untuk [korokk.com](https://korokk.com/blog/). Tulis dalam browser (PC atau phone), upload gambar, dan tekan **Terbit**. Studio commit post terus ke repo [Kengkorok.github.io](https://github.com/Kengkorok/Kengkorok.github.io), dan GitHub Pages siarkan dalam ~1 minit.

Jalan dalam Docker di server rumah, dibuka melalui Cloudflare Tunnel dan dikunci dengan Cloudflare Access.

## Ciri

- **Editor:**
  - Tebal, condong, garis bawah, pautan, H2/H3, senarai, petikan, garis pemisah dan gambar.
  - Menu kecil muncul bila teks dipilih.
  - Butang `</>` tukar ke HTML mentah dan balik.
- **Gambar:**
  - Tampal, seret atau pilih fail.
  - Gambar dikecilkan ke WebP (lebar maks 1600px) dan metadata (termasuk lokasi GPS) dibuang.
- **Video:**
  - Upload (butang, tampal atau seret) sehingga 1GB dan 10 minit. Dihantar dalam cebisan 32MB sebab Cloudflare hadkan 100MB setiap permintaan.
  - ffmpeg tukar ke MP4 H.264 (sisi panjang maks 1280px), buang metadata dan jana poster WebP. Hasil mesti bawah 45MB supaya repo laman kekal kecil.
  - Video panjang: butang YouTube (atau tampal link YouTube terus), embed guna youtube-nocookie.com.
- **Draf:** disimpan automatik dalam SQLite di server. GitHub hanya dapat commit bila kau tekan Terbit.
- **Imej OG automatik:** post tanpa cover dapat kad 1200x630 bertajuk untuk pratonton link WhatsApp/Threads.
- **Pratonton:** guna CSS blog sebenar dari korokk.com.
- **Post lama:** post yang dah terbit (termasuk yang ditulis dalam Markdown) boleh dibuka dan dikemas kini.
- **Moderasi komen:** luluskan atau padam komen "nama sahaja" dari Worker `komen`.
- **Penulis agent AI:** Claudrok (Claude) dan korokGPT (ChatGPT) boleh hantar draf melalui API. Draf masuk dengan lencana penulis dan kau terbit sendiri. Lihat [Agent](#agent).
- **Statistik:** page view dan pelawat (sepanjang masa, 7 hari lepas, tahun ini), post paling dibaca, bilangan post dan komen.
  - Dikira oleh `main.js` di laman (`/hit` pada Worker `komen`, jadual `lawatan` dalam D1).
  - Browser yang buka Studio dapat cookie `korok_abai` pada `.korokk.com` dan tak dikira. Peranti lain: buka `korokk.com/?abai=1` sekali (`?abai=0` untuk batal).
  - Bilangan komen GitHub (giscus) perlukan permission **Discussions: Read** pada token.
- **Tema:** cerah/gelap ikut sistem, dengan butang tukar.
- **Phone:** toolbar duduk di atas papan kekunci.

## Pasang di server rumah

### 1. Token GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
- Repository access: **Only select repositories** → `Kengkorok.github.io`
- Permissions: **Contents: Read and write**
- Pilihan: **Discussions: Read**, untuk bilangan komen giscus dalam Statistik

### 2. Cloudflare Tunnel dan Access

Zero Trust dashboard:
1. **Networks → Tunnels** → pilih tunnel `korok-tunnel` → **Public hostname** → Add:
   - Subdomain `studio`, domain `korokk.com`
   - Service: `HTTP` → `localhost:8460`
2. **Access → Applications** → Add an application → **Self-hosted**:
   - Domain `studio.korokk.com`
   - Policy: Allow, Include → Emails → email kau
   - Selepas simpan, salin **Application Audience (AUD) Tag** dari tab Overview
3. Nama team ada di **Settings → Custom Pages** (contoh `nama-team.cloudflareaccess.com`).

### 3. Jalankan

```bash
cp .env.example .env    # isi GITHUB_TOKEN, ACCESS_*, KOMEN_ADMIN_TOKEN
docker compose up -d --build
```

Buka https://studio.korokk.com.

Port hanya dibuka di `127.0.0.1:8460`, jadi Studio tak boleh dicapai dari LAN atau internet kecuali melalui tunnel. Server juga sahkan JWT Cloudflare Access pada setiap permintaan. Tanpa `ACCESS_TEAM_DOMAIN` dan `ACCESS_AUD`, Studio mengunci diri.

## Env

| Env | Wajib | Guna |
| --- | --- | --- |
| `GITHUB_TOKEN` | ya | Token fine-grained, Contents read/write untuk repo blog |
| `GITHUB_REPO` | | Default `Kengkorok/Kengkorok.github.io` |
| `GITHUB_BRANCH` | | Default `main` |
| `SITE_URL` | | Default `https://korokk.com` |
| `ACCESS_TEAM_DOMAIN` | ya | Contoh `nama-team.cloudflareaccess.com` |
| `ACCESS_AUD` | ya | AUD tag aplikasi Access |
| `ACCESS_EMAILS` | | Senarai email dibenarkan (koma). Lapisan kedua selepas polisi Access |
| `KOMEN_API` | | URL Worker komen, contoh `https://komen.sa7one.workers.dev` |
| `KOMEN_ADMIN_TOKEN` | | `ADMIN_TOKEN` Worker komen |
| `AGENT_TOKENS` | | `claudrok:token,korokgpt:token`. Token untuk agent AI |
| `NOTIFY_WEBHOOK` | | Webhook Discord untuk notifikasi draf baru dari agent |
| `STUDIO_URL` | | Default `https://studio.korokk.com`. Dipakai dalam link yang dipulangkan kepada agent |

## Agent

Agent AI hantar draf ke `/api/agent/*` dengan header `Authorization: Bearer <token>`. Token menentukan nama penulis, jadi agent tak boleh menyamar. Agent hanya boleh buat, baca dan ubah draf sendiri yang belum terbit. Terbit tetap dibuat dalam Studio.

| Laluan | Guna |
| --- | --- |
| `GET /api/agent/saya` | Semak token: nama penulis |
| `GET /api/agent/gaya` | Panduan gaya tulisan (Markdown) |
| `GET /api/agent/tags` | Tag sedia ada dan bilangan post |
| `POST /api/agent/drafts` | Buat draf baru |
| `GET /api/agent/drafts/:id` | Baca draf sendiri |
| `PUT /api/agent/drafts/:id` | Ubah draf sendiri (sebelum terbit) |

Contoh badan `POST /api/agent/drafts`:

```json
{
  "title": "Event Pokémon GO Hujung Minggu Ni",
  "description": "Satu ayat ringkasan, maksimum 200 aksara.",
  "markdown": "Aku baru terbaca...\n\n## Apa yang ada?\n\n- ...",
  "tags": ["pokemon-go", "teknologi"],
  "sumber": { "url": "https://pokemongolive.com/...", "title": "Pokémon GO Live" },
  "cover": { "dari_sumber": true, "alt": "Terangkan gambar", "kredit": "Gambar: Niantic" }
}
```

- **Isi:** `markdown` atau `html`. Skrip, iframe, pengendali event dan link `javascript:` dibuang.
- **Tag:** disatukan dengan tag sedia ada yang ejaannya hampir sama (technology → teknologi). Maksimum 8.
- **Cover:** satu daripada yang berikut. Kalau gambar gagal diambil, draf guna kad OG auto dan jawapan ada `amaran`.
  - `{ "url": "https://..." }`
  - `{ "dari_sumber": true }`: og:image halaman sumber
  - `{ "base64": "..." }`: gambar AI
  - `{ "auto": true }`: kad OG auto
- **Gambar dari internet:** hanya `https` ke alamat awam, maksimum 15MB.

Panduan gaya ada dalam [`agent/gaya-tulisan.md`](agent/gaya-tulisan.md). Untuk ubah tanpa bina semula container, salin ke `data/gaya-tulisan.md` dan sunting salinan tu.

## Macam mana post disimpan

Terbit menghasilkan **satu commit** yang mengandungi:
- `_posts/TARIKH-slug.html`: front matter (tajuk, ringkasan, tag, imej) dan isi HTML dalam `{% raw %}` supaya Liquid tak usik teks.
- `assets/blog/TAHUN/slug/*.webp`: gambar (dan poster video) yang digunakan.
- `assets/blog/TAHUN/slug/*.mp4`: video yang diupload.
- `assets/blog/TAHUN/slug/og.png`: imej OG automatik (kalau tiada cover).

Kalau slug atau tarikh post lama ditukar, fail lama dibuang dalam commit yang sama. **Tarik balik** buang fail post dari repo, tapi draf kekal dalam Studio.

## Backup

Semua draf dan gambar belum terbit ada dalam folder `data/` (`studio.db` dan `uploads/`). Masukkan folder tu dalam backup server.

## Pembangunan

```bash
npm install
cp .env.example .env
npm run dev     # ALLOW_NO_AUTH=1, http://127.0.0.1:8460
```

Perlukan `ffmpeg` dalam PATH untuk video.

Kod: `server/` (Hono, node:sqlite, sharp, ffmpeg) dan `client/` (TipTap, dibundle dengan esbuild).

## Kredit

Font [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) dan [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) dalam `fonts/` di bawah [SIL Open Font License](fonts/OFL.txt).
