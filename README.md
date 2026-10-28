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
- **Draf:** disimpan automatik dalam SQLite di server. GitHub hanya dapat commit bila kau tekan Terbit.
- **Imej OG automatik:** post tanpa cover dapat kad 1200x630 bertajuk untuk pratonton link WhatsApp/Threads.
- **Pratonton:** guna CSS blog sebenar dari korokk.com.
- **Post lama:** post yang dah terbit (termasuk yang ditulis dalam Markdown) boleh dibuka dan dikemas kini.
- **Moderasi komen:** luluskan atau padam komen "nama sahaja" dari Worker `komen`.
- **Tema:** cerah/gelap ikut sistem, dengan butang tukar.
- **Phone:** toolbar duduk di atas papan kekunci.

## Pasang di server rumah

### 1. Token GitHub

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:
- Repository access: **Only select repositories** → `Kengkorok.github.io`
- Permissions: **Contents: Read and write** (yang lain biarkan)

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

## Macam mana post disimpan

Terbit menghasilkan **satu commit** yang mengandungi:
- `_posts/TARIKH-slug.html`: front matter (tajuk, ringkasan, tag, imej) dan isi HTML dalam `{% raw %}` supaya Liquid tak usik teks.
- `assets/blog/TAHUN/slug/*.webp`: gambar yang digunakan.
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

Kod: `server/` (Hono, node:sqlite, sharp) dan `client/` (TipTap, dibundle dengan esbuild).

## Kredit

Font [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) dan [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) dalam `fonts/` di bawah [SIL Open Font License](fonts/OFL.txt).
