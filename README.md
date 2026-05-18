# Scaffold: Web Streaming Dracin dengan Multi-API

Dokumen ini adalah kerangka kerja (scaffold) instruksi untuk AI Agent untuk membangun website streaming Dracin (Drama China) menggunakan Svelte (Vite) dan Node.js/Bun Proxy.

## 1. Deskripsi Proyek
Membangun web frontend dan backend proxy untuk menonton Dracin dari beberapa sumber API (Flickreels dan Stardust). Proyek ini membutuhkan sistem autentikasi, manajemen pengguna, dan proxy yang aman untuk menyembunyikan kredensial API asli.

## 2. Arsitektur, Teknologi & Struktur Proyek
*   **Frontend**: Svelte + Vite (SPA, Tanpa SvelteKit). Menggunakan **Svelte Stores** untuk State Management.
*   **Backend / Proxy**: Bun JS (`src/backend/proxy.js`) menggunakan native `Bun.serve()` atau framework super ringan seperti Hono.
*   **Database**: MySQL (Data user & relasi) dan Redis / In-memory Cache (untuk caching URL streaming).
*   **Video Player**: Menggunakan `Plyr` atau `Video.js` yang terintegrasi dengan `hls.js` untuk mendukung pemutaran `.m3u8`.


### Struktur Direktori yang Diharapkan:
```text
├── src/                  # Frontend Svelte
│   ├── components/       # UI Components (Navbar, VideoPlayer, Card)
│   ├── stores/           # Svelte Stores (auth.js, watch.js)
│   ├── App.svelte        # Main Entry Frontend
│   └── main.js
├── backend/              # Backend Bun JS
│   ├── proxy.js          # Main Entry Server & Proxy Routes
│   ├── db.js             # Koneksi & Driver MySQL
│   └── cache.js          # Logika Caching (Redis / In-memory)
├── package.json
└── README.md
```
## 3. Fitur Utama & Persyaratan Sistem

### 3.1. Autentikasi & Manajemen Pengguna
*   **Keamanan Kredensial**: Register dan Login menggunakan Email & Password. Password wajib di-hash menggunakan `bcrypt` atau native `Bun.password`.
*   **Manajemen Sesi**: Sistem Auth wajib menggunakan **JWT (JSON Web Token)** yang disimpan di **HTTP-Only Cookie** (direkomendasikan untuk keamanan maksimal dari serangan XSS).
*   **Alur Tambahan**: Fitur Logout menghapus cookie/sesi. Fitur Lupa Password menggunakan *mock email sending* atau endpoint reset token sementara.
*   **Skema Database (MySQL)**:
    ```sql
    CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        subscription_status ENUM('active', 'inactive') DEFAULT 'inactive',
        subscription_expires_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE subscription_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        status_before ENUM('active', 'inactive') NOT NULL,
        status_after ENUM('active', 'inactive') NOT NULL,
        expires_at_before DATETIME NULL,
        expires_at_after DATETIME NULL,
        action_type ENUM('register', 'subscribe', 'renew', 'expire', 'cancel') NOT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE bookmarks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        drama_id VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        poster_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE watch_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        drama_id VARCHAR(100) NOT NULL,
        episode_id VARCHAR(100) NOT NULL,
        last_position_seconds INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY user_episode_unique (user_id, drama_id, episode_id)
    );

    /* Tabel Tambahan untuk Keperluan Analitik Cepat */
    CREATE TABLE analytics_daily_stats (
        date DATE PRIMARY KEY,
        total_active_users INT DEFAULT 0,
        total_registrations INT DEFAULT 0,
        total_views INT DEFAULT 0,
        total_subscriptions_revenue_count INT DEFAULT 0
    );
    ```
### 3.2. Fitur Pengguna & Dashboard Admin (User Experience & Analytics)
*   **Last Watch**: Menyimpan `last_position_seconds` ke database. Wajib mengimplementasikan mekanisme **debounce** di frontend untuk mengirim data koordinat durasi setiap **10 detik** saat video diputar, atau secara instan (tanpa debounce) saat video di-*pause* atau komponen di-*unmount*.
*   **Pemilihan Bahasa & Resolusi**: Jika API penyedia (berdasarkan dokumen di `api-examples/`) menyediakan opsi multi-bahasa (audio/subtitle) atau multi-resolusi (360p, 480p, 720p, 1080p), frontend Svelte harus menyediakan UI *dropdown selector* di dalam video player agar user dapat memilih kualitas dan bahasa sesuai preferensi secara dinamis.
*   **History & Bookmark**: Halaman dashboard khusus untuk menarik dan menampilkan list data dari tabel `watch_history` dan `bookmarks` secara real-time.
*   **Admin Analytics Dashboard**: Halaman khusus admin (`role === 'admin'`) yang menyajikan visualisasi data berupa grafik/chart untuk metrik pendaftaran, user aktif harian (DAU), akumulasi total *views*, konten terpopuler, serta rasio konversi user premium bersubskripsi aktif.

### 3.3. Proxy & Keamanan (Sangat Penting)
*   **Hide API Key**: Frontend **dilarang keras** menembak langsung ke API Provider eksternal. Semua request harus diarahkan ke proxy lokal backend: `/api/video/:provider/:id`.
*   **Environment Variables**: Kredensial pihak ketiga (`FLICKREELS_API_KEY` dan `STARDUST_API_KEY`) harus disimpan dengan aman di file `.env` di sisi backend.
*   **Filter & Transform Response**: Sebelum proxy mengirimkan response JSON kembali ke Svelte, bersihkan semua parameter internal milik provider. Backend wajib melakukan *mapping/transformasi* terhadap data resolusi dan bahasa dari skema asli provider menjadi format JSON standar yang seragam untuk frontend.
*   **Referensi Struktur API**: AI Agent **wajib** membaca dan mengikuti struktur data asli yang berada di dalam folder `api-examples/` sebagai acuan *request payload*, penanganan parameter bahasa, dan objek resolusi video.
*   **Admin Route Guard**: Semua endpoint analitik (`/api/admin/*`) wajib divalidasi oleh middleware untuk memastikan bahwa token JWT yang dikirimkan memiliki klaim `role: 'admin'`.

### 3.4. Caching & Temporary URL Streaming
Sistem wajib memeriksa layer cache (`UrlCache` via Redis atau In-memory object) sebelum melakukan *hit* ke API Provider guna menghindari limitasi query per IP address (*rate limiting*).
*   **Flickreels (TTL 30 Menit)**:
    *   Simpan stream URL video ke cache dengan batas waktu (TTL) **1800 detik (30 menit)**.
    *   Jika request menyertakan parameter spesifik seperti bahasa atau resolusi, pastikan key pada cache memisahkan opsi tersebut (contoh key: `flickreels:id:resolution:lang`).
    *   Jika cache *expired* atau *miss*, lakukan fetch ulang ke API Flickreels, perbarui cache dengan TTL baru, lalu teruskan ke client.
*   **Stardust (Permanent / No Timeout)**:
    *   Simpan stream URL ke dalam cache/database secara permanen (No Expiration) karena karakteristik URL dari provider ini bersifat abadi.

---

## 4. Langkah-langkah Implementasi (Task untuk AI Agent)

### Fase 1: Setup Database & Backend Dasar
1.  Inisialisasi database MySQL dan eksekusi pembuatan tabel sesuai dengan skema di poin 3.1.
2.  Buat berkas server utama di `backend/proxy.js`. Implementasikan rute autentikasi dasar: `/api/auth/register`, `/api/auth/login`, dan `/api/auth/logout`.
3.  Bangun middleware autentikasi JWT untuk memvalidasi sesi user sebelum mereka diizinkan mengakses endpoint proteksi (seperti video proxy, history, dan bookmark).
4.  Buat middleware khusus bernama `isAdmin` untuk memproteksi jalur endpoint analitik.

### Fase 2: Implementasi Proxy, Multi-Resolusi/Bahasa & Caching URL
1.  Sediakan endpoint proxy video yang menerima query parameter pilihan user: `/api/video/:provider/:id?res=1080p&lang=id`.
2.  **Gunakan skema berkas pada folder `api-examples/`** untuk mendeteksi bagaimana parameter bahasa dikirimkan (misal lewat header atau query string) dan bagaimana opsi resolusi diekstrak dari respon asli provider.
3.  Terapkan logika percabangan backend:
    *   **Jika `provider === 'flickreels'`**: Periksa cache berdasarkan kombinasi ID, resolusi, dan bahasa. Jika *miss*, hit API Flickreels, saring response-nya, simpan ke cache dengan TTL 30 menit, kemudian return objek video bersih ke client.
    *   **Jika `provider === 'stardust'`**: Periksa cache. Jika *miss*, hit API Stardust, simpan di cache secara permanen, kemudian return URL ke client.
4.  Terapkan manajemen *error handling* yang matang. Jika API provider mengalami gangguan atau *timeout*, balikkan status `502 Bad Gateway` dengan pesan yang aman.
5.  **Endpoint Analitik Admin**: Buat route `/api/admin/analytics/overview` yang melakukan query agregasi (menggunakan `COUNT`, `GROUP BY`) untuk menarik data tren pendaftaran user, drama paling banyak ditonton (dari tabel `watch_history`), dan status konversi subskripsi.

### Fase 3: Frontend Svelte UI & Integrasi (Termasuk Selector & Chart Admin)
1.  Konfigurasi sistem routing di frontend Svelte menggunakan library SPA router ringan seperti `svelte-spa-router` atau `tinro`.
2.  Desain halaman UI untuk Login dan Register yang terintegrasi langsung dengan API Auth milik Bun backend.
3.  Buat komponen `VideoPlayer.svelte` dengan memanfaatkan engine `hls.js` agar lancar memutar berkas berformat `.m3u8` maupun `.mp4`.
4.  **Integrasi Media Menu**: Buat kontrol UI tambahan (tombol gir/setting) di dalam video player untuk memfasilitasi pemilihan bahasa dan resolusi video berdasarkan daftar opsi yang dikirimkan oleh backend proxy. Ketika opsi diubah, player harus memuat ulang source URL yang sesuai tanpa mereset total *current playback time*.
5.  Pasang event listener `timeupdate` pada elemen video player. Integrasikan fungsi *debounce* (10 detik) untuk sinkronisasi data Last Watch ke endpoint `/api/history/update`.
6.  Selesaikan halaman Dashboard/Profil untuk menampilkan daftar bookmark aktif dan riwayat tontonan terakhir user.
7.  **Admin Panel**: Integrasikan library grafik ringan seperti `Chart.js` atau `Frappe Charts` pada halaman khusus admin `/admin/dashboard` untuk menampilkan visualisasi data tren dari endpoint analitik backend.

### Fase 4: Pengujian & Validasi (Definisi Selesai)
1.  **Validasi Environment**: Pastikan tidak ada kebocoran kredensial API pihak ketiga di Client-Side maupun pada tab Network di Developer Tools browser.
2.  **Validasi Kecocokan API**: Pastikan skema *request/response* serta pemetaan parameter bahasa/resolusi yang ditangani oleh proxy backend sudah sepenuhnya cocok dengan contoh dokumen yang berada di `api-examples/`.
3.  **Validasi Fungsionalitas Player**: Pastikan perpindahan resolusi dan bahasa berjalan mulus di video player tanpa merusak tracker durasi *Last Watch*.
4.  **Validasi Cache TTL**: Verifikasi bahwa request berulang untuk ID video Flickreels dengan resolusi dan bahasa yang sama dalam rentang < 30 menit akan melayani data dari Cache, bukan melakukan hit berulang ke API Flickreels asli.
5.  **Validasi Sinkronisasi Video**: Pastikan ketika user membuka kembali video yang belum selesai ditonton, pemutaran video secara otomatis melompat (*seek*) ke timestamp terakhir dari database.
6.  **Validasi Autorisasi Analitik**: Pastikan akun dengan `role: 'user'` diblokir dengan respon `403 Forbidden` saat mencoba mengakses data analitik admin, baik via frontend routing maupun direct API call.