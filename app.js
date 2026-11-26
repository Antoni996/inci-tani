const KATEGORI_STATIS = ["Obat", "Pupuk"];
const TOKO_DEFAULT = ["Toko A", "Toko B"];
const STORAGE_KEY_CLOUD = "inci_tani_cloud_config_v1";
const STORAGE_KEY_SESSION = "inci_tani_auth_session_v1";
const INTERVAL_SINKRON_MS = 5 * 60 * 1000; // 5 menit

// Isi dengan Project URL dan Publishable / anon key dari Supabase kamu
const CLOUD_DEFAULT = {
  url: "https://svcsyhuvmwvtymareyxu.supabase.co",
  anonKey: ""
};

let daftarToko = [];
let draftToko = [];
let tempIdCounter = -1;
let idSedangDiedit = null;
let idDetailAktif = null;
let kategoriAktif = KATEGORI_STATIS[0];
let semuaBarangCache = [];
let indexPesanKonfirmasi = 0;
let waktuSyncTerakhir = null;
let sedangMemuat = false;
let sedangMenyimpanBarang = false;
let sesiAuth = null;
let resolverModalPesan = null;
let timerCountdownAlert = null;
let timerSinkronOtomatis = null;

function setIkonModalPesan(bahaya = false) {
  const badge = document.getElementById("pesan-modal-ikon");
  if (!badge) return;
  badge.classList.toggle("tipe-peringatan", Boolean(bahaya));
  if (bahaya) {
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;
  } else {
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;
  }
}

function bersihkanTimerCountdownAlert() {
  if (timerCountdownAlert) {
    clearInterval(timerCountdownAlert);
    timerCountdownAlert = null;
  }
}

function tutupModalPesanInternal(hasil, karenaHabisWaktu = false) {
  bersihkanTimerCountdownAlert();
  const backdrop = document.getElementById("modal-pesan");
  if (backdrop) {
    backdrop.classList.remove("aktif");
  }
  const fn = resolverModalPesan;
  resolverModalPesan = null;
  if (typeof fn === "function") {
    fn(hasil, karenaHabisWaktu);
  }
}

function tampilkanAlert(pesan, opsi = {}) {
  return new Promise(resolve => {
    if (resolverModalPesan) {
      tutupModalPesanInternal(false, false);
    }
    const judul = opsi.judul || "Informasi";
    const teksOk = opsi.teksOk || "Oke";
    const bahaya = Boolean(opsi.bahaya);
    const countdownDetik = Number(opsi.countdownDetik || 0);
    const tutupModalBarangSaatSelesai = Boolean(opsi.tutupModalBarangSaatSelesai);

    document.getElementById("pesan-modal-judul").textContent = judul;
    document.getElementById("pesan-modal-isi").textContent = String(pesan || "");
    setIkonModalPesan(bahaya);

    const btnBatal = document.getElementById("pesan-btn-batal");
    const btnOk = document.getElementById("pesan-btn-ok");

    btnBatal.style.display = "none";
    btnBatal.onclick = null;

    btnOk.className = bahaya ? "btn-hapus" : "";

    const selesaikanAlert = (karenaHabisWaktu) => {
      tutupModalPesanInternal(true, karenaHabisWaktu);
      if (tutupModalBarangSaatSelesai) {
        tutupModalBarang();
      }
      resolve(karenaHabisWaktu);
    };

    if (countdownDetik > 0) {
      let sisa = countdownDetik;
      btnOk.textContent = `${teksOk} (${sisa})`;
      btnOk.onclick = () => selesaikanAlert(false);

      timerCountdownAlert = setInterval(() => {
        sisa -= 1;
        if (sisa <= 0) {
          selesaikanAlert(true);
        } else {
          btnOk.textContent = `${teksOk} (${sisa})`;
        }
      }, 1000);
    } else {
      btnOk.textContent = teksOk;
      btnOk.onclick = () => selesaikanAlert(false);
    }

    resolverModalPesan = (val, habis) => resolve(Boolean(habis));
    lepasFokusAktif();
    document.getElementById("modal-pesan").classList.add("aktif");
  });
}

function tampilkanKonfirmasi(pesan, opsi = {}) {
  return new Promise(resolve => {
    if (resolverModalPesan) {
      tutupModalPesanInternal(false, false);
    }
    const judul = opsi.judul || "Konfirmasi";
    const teksYa = opsi.teksYa || "Oke";
    const teksBatal = opsi.teksBatal || "Batal";
    const bahaya = Boolean(opsi.bahaya);

    document.getElementById("pesan-modal-judul").textContent = judul;
    document.getElementById("pesan-modal-isi").textContent = String(pesan || "");
    setIkonModalPesan(bahaya);

    const btnBatal = document.getElementById("pesan-btn-batal");
    const btnOk = document.getElementById("pesan-btn-ok");

    btnBatal.style.display = "inline-block";
    btnBatal.textContent = teksBatal;
    btnBatal.onclick = () => {
      tutupModalPesanInternal(false, false);
      resolve(false);
    };

    btnOk.textContent = teksYa;
    btnOk.className = bahaya ? "btn-hapus" : "";
    btnOk.onclick = () => {
      tutupModalPesanInternal(true, false);
      resolve(true);
    };

    resolverModalPesan = val => resolve(Boolean(val));
    lepasFokusAktif();
    document.getElementById("modal-pesan").classList.add("aktif");
  });
}

function mulaiSinkronOtomatisLimaMenit() {
  if (timerSinkronOtomatis) {
    clearInterval(timerSinkronOtomatis);
  }
  timerSinkronOtomatis = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      navigator.onLine &&
      cloudSudahDiatur() &&
      muatSesiAuth() &&
      !sedangMemuat &&
      !sedangMenyimpanBarang
    ) {
      muatDataDariCloud(false, "Auto-sync");
    }
  }, INTERVAL_SINKRON_MS);
}

function ambilKonfigurasiCloud() {
  const defaultUrl = String(CLOUD_DEFAULT.url || "").trim().replace(/\/+$/, "");
  const defaultKey = String(CLOUD_DEFAULT.anonKey || "").trim();
  if (defaultUrl && defaultKey) {
    return { url: defaultUrl, anonKey: defaultKey };
  }

  try {
    const tersimpan = localStorage.getItem(STORAGE_KEY_CLOUD);
    if (tersimpan) {
      const parsed = JSON.parse(tersimpan);
      return {
        url: String(parsed.url || "").trim().replace(/\/+$/, ""),
        anonKey: String(parsed.anonKey || "").trim()
      };
    }
  } catch (e) {}

  return { url: defaultUrl, anonKey: defaultKey };
}

function cloudSudahDiatur() {
  const cfg = ambilKonfigurasiCloud();
  return Boolean(cfg.url && cfg.anonKey);
}

function simpanSesiAuth(sesi) {
  sesiAuth = sesi;
  try {
    if (sesi) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sesi));
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  } catch (e) {}
}

function muatSesiAuth() {
  if (sesiAuth && sesiAuth.access_token) return sesiAuth;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.access_token) {
        sesiAuth = parsed;
        return sesiAuth;
      }
    }
  } catch (e) {}
  return null;
}

async function refreshTokenJikaPerlu() {
  const sesi = muatSesiAuth();
  if (!sesi) return null;

  const sekarangDetik = Math.floor(Date.now() / 1000);
  const expiresAt = Number(sesi.expires_at || 0);
  if (expiresAt && expiresAt - sekarangDetik > 60) {
    return sesi;
  }

  if (!sesi.refresh_token || !cloudSudahDiatur()) {
    return sesi;
  }

  const cfg = ambilKonfigurasiCloud();
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: sesi.refresh_token })
    });
    if (!res.ok) {
      simpanSesiAuth(null);
      return null;
    }
    const dataBaru = await res.json();
    const sesiBaru = {
      access_token: dataBaru.access_token,
      refresh_token: dataBaru.refresh_token || sesi.refresh_token,
      expires_at: dataBaru.expires_at || (Math.floor(Date.now() / 1000) + Number(dataBaru.expires_in || 3600)),
      email: (dataBaru.user && dataBaru.user.email) || sesi.email
    };
    simpanSesiAuth(sesiBaru);
    return sesiBaru;
  } catch (e) {
    return sesi;
  }
}

function tampilkanHalamanAplikasi() {
  document.getElementById("halaman-login").style.display = "none";
  document.getElementById("halaman-utama").style.display = "block";
}

function tampilkanHalamanLogin(pesanError = "") {
  document.getElementById("halaman-detail").style.display = "none";
  document.getElementById("halaman-utama").style.display = "none";
  document.getElementById("halaman-login").style.display = "block";
  const elPesan = document.getElementById("login-pesan");
  if (elPesan) {
    elPesan.textContent = pesanError;
  }
}

async function prosesLogin(event) {
  event.preventDefault();
  const elPesan = document.getElementById("login-pesan");
  const btnLogin = document.getElementById("btn-login");
  if (elPesan) elPesan.textContent = "";

  if (!cloudSudahDiatur()) {
    if (elPesan) {
      elPesan.textContent = "Konfigurasi Supabase (CLOUD_DEFAULT) belum diisi di app.js.";
    }
    return;
  }

  const email = (document.getElementById("login-email").value || "").trim();
  const password = document.getElementById("login-password").value || "";
  if (!email || !password) return;

  const cfg = ambilKonfigurasiCloud();
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.textContent = "Memeriksa...";
  }

  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(data.msg || data.error_description || "Email atau kata sandi salah.");
    }

    simpanSesiAuth({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)),
      email: (data.user && data.user.email) || email
    });

    document.getElementById("login-password").value = "";
    tampilkanHalamanAplikasi();
    await muatDataDariCloud(false);
    mulaiSinkronOtomatisLimaMenit();
  } catch (err) {
    if (elPesan) {
      elPesan.textContent = err.message || "Gagal masuk.";
    }
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = "Masuk";
    }
  }
}

async function prosesLogout() {
  const sesi = muatSesiAuth();
  const cfg = ambilKonfigurasiCloud();
  if (sesi && sesi.access_token && cfg.url && cfg.anonKey) {
    try {
      await fetch(`${cfg.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${sesi.access_token}`
        }
      });
    } catch (e) {}
  }
  simpanSesiAuth(null);
  daftarToko = [];
  semuaBarangCache = [];
  idSedangDiedit = null;
  idDetailAktif = null;
  tampilkanHalamanLogin("");
}

function perbaruiStatusSync(labelStatus = null) {
  const el = document.getElementById("status-sync-teks");
  if (!el) return;

  const online = navigator.onLine;
  const terhubung = cloudSudahDiatur();

  let cloudTeks = "<strong>Belum diatur</strong>";
  if (terhubung) {
    if (sedangMemuat) {
      cloudTeks = "<strong>Menyinkronkan...</strong>";
    } else if (!online) {
      cloudTeks = "<strong>Offline</strong> (butuh internet)";
    } else if (labelStatus) {
      cloudTeks = `<strong>${escapeHtml(labelStatus)}</strong>`;
    } else {
      cloudTeks = "<strong>Terhubung</strong>";
    }
  }

  const waktuTeks = waktuSyncTerakhir
    ? ` &bull; Sinkron: ${escapeHtml(formatWaktu(waktuSyncTerakhir))}`
    : "";

  el.innerHTML = `Mode: <strong>Langsung Cloud</strong> &bull; Supabase: ${cloudTeks}${waktuTeks}`;
}

async function requestSupabase(tabel, method = "GET", body = null, query = "") {
  const cfg = ambilKonfigurasiCloud();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Konfigurasi cloud belum diatur.");
  }

  const sesi = await refreshTokenJikaPerlu();
  if (!sesi || !sesi.access_token) {
    tampilkanHalamanLogin("Sesi berakhir. Silakan masuk kembali.");
    throw new Error("Belum login ke akun toko.");
  }

  const endpoint = `${cfg.url}/rest/v1/${tabel}${query}`;
  const headers = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${sesi.access_token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (res.status === 401) {
    simpanSesiAuth(null);
    tampilkanHalamanLogin("Sesi tidak valid. Silakan masuk kembali.");
    throw new Error("Akses ditolak (401). Silakan login ulang.");
  }

  if (!res.ok) {
    const detailError = await res.text();
    throw new Error(`HTTP ${res.status}: ${detailError || "Gagal terhubung ke Supabase"}`);
  }

  if (res.status === 204) return [];
  const teks = await res.text();
  return teks ? JSON.parse(teks) : [];
}

function bersihkanInputAngkaUkuran(input) {
  if (!input) return;
  let val = String(input.value || "").replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  const bagian = val.split(".");
  if (bagian.length > 2) {
    val = `${bagian[0]}.${bagian.slice(1).join("")}`;
  }
  if (input.value !== val) {
    input.value = val;
  }
}

function pisahkanUkuranDanSatuan(ukuranTersimpan, kategori = "Obat", satuanTersimpan = "") {
  const raw = String(ukuranTersimpan || "").trim();
  const satRaw = String(satuanTersimpan || "").trim().toLowerCase();

  if (kategori === "Pupuk") {
    const satuanDipakai = "sack";
    if (!raw || raw === "-") {
      return { angka: "", satuan: satuanDipakai };
    }
    const match = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(sack|kg)?$/i);
    if (match) {
      return { angka: match[1].replace(",", "."), satuan: satuanDipakai };
    }
    const angkaSaja = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
    return { angka: angkaSaja, satuan: satuanDipakai };
  }

  const satuanValidObat = ["ml", "gram", "kg"];
  if (!raw || raw === "-") {
    return {
      angka: "",
      satuan: satuanValidObat.includes(satRaw) ? satRaw : "ml"
    };
  }

  const match = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(ml|gram|kg)?$/i);
  if (match) {
    return {
      angka: match[1].replace(",", "."),
      satuan: match[2] && satuanValidObat.includes(match[2].toLowerCase())
        ? match[2].toLowerCase()
        : (satuanValidObat.includes(satRaw) ? satRaw : "ml")
    };
  }

  const angkaSaja = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
  return {
    angka: angkaSaja,
    satuan: satuanValidObat.includes(satRaw) ? satRaw : "ml"
  };
}

function susunUkuranGabungan(nilaiUkuran, kategori = "Obat", satuan = "") {
  const { angka, satuan: satTerurai } = pisahkanUkuranDanSatuan(nilaiUkuran, kategori, satuan);
  const angkaBersih = String(angka || "").trim();
  if (!angkaBersih || angkaBersih === "-") return "-";
  const satuanDipakai = kategori === "Pupuk" ? "sack" : (satTerurai || "ml");
  return `${angkaBersih} ${satuanDipakai}`;
}

function normalisasiBarisBarangCloud(row) {
  const kat = row.kategori === "Pupuk" ? "Pupuk" : "Obat";
  const rawSatuan = row.satuan_ukuran ?? row.satuanUkuran ?? null;
  const satuanUkuran = kat === "Pupuk"
    ? "sack"
    : (["ml", "gram", "kg"].includes(String(rawSatuan || "").toLowerCase())
      ? String(rawSatuan).toLowerCase()
      : pisahkanUkuranDanSatuan(row.ukuran, "Obat", rawSatuan).satuan);

  return {
    id: row.id,
    nama: row.nama || "",
    kategori: kat,
    ukuran: susunUkuranGabungan(row.ukuran, kat, satuanUkuran),
    satuanUkuran,
    hargaJual: kat === "Obat" ? 0 : Number(row.harga_jual ?? row.hargaJual ?? 0),
    hargaToko: row.harga_toko || row.hargaToko || {},
    dibuatPada: row.dibuat_pada || row.dibuatPada || null,
    dieditPada: row.diedit_pada || row.dieditPada || null,
    riwayatEdit: Array.isArray(row.riwayat_edit || row.riwayatEdit)
      ? (row.riwayat_edit || row.riwayatEdit)
      : []
  };
}

function susunPayloadBarangCloud(data) {
  const hargaTokoClean = {};
  const rawHt = data.hargaToko || {};
  Object.keys(rawHt).forEach(k => {
    hargaTokoClean[String(k)] = Number(rawHt[k] || 0);
  });

  const isPupuk = data.kategori === "Pupuk";
  const satuanSimpan = isPupuk
    ? "sack"
    : (["ml", "gram", "kg"].includes(String(data.satuanUkuran || "").toLowerCase())
      ? String(data.satuanUkuran).toLowerCase()
      : "ml");

  return {
    nama: data.nama,
    kategori: data.kategori,
    ukuran: susunUkuranGabungan(data.ukuran, data.kategori, satuanSimpan),
    satuan_ukuran: satuanSimpan,
    harga_jual: isPupuk ? Number(data.hargaJual || 0) : 0,
    harga_toko: hargaTokoClean,
    dibuat_pada: data.dibuatPada || new Date().toISOString(),
    diedit_pada: data.dieditPada || null,
    riwayat_edit: Array.isArray(data.riwayatEdit) ? data.riwayatEdit : []
  };
}

async function muatDataDariCloud(tampilkanPesan = false, labelSukses = "Tersinkron") {
  if (!cloudSudahDiatur()) {
    perbaruiStatusSync();
    if (tampilkanPesan) {
      await tampilkanAlert("Konfigurasi Supabase (CLOUD_DEFAULT) belum diisi di app.js.", {
        judul: "Konfigurasi Belum Lengkap",
        bahaya: true
      });
    }
    return false;
  }

  if (!muatSesiAuth()) {
    tampilkanHalamanLogin("Silakan masuk terlebih dahulu.");
    return false;
  }

  if (!navigator.onLine) {
    perbaruiStatusSync("Offline");
    if (tampilkanPesan) {
      await tampilkanAlert("Perangkat sedang offline. Aplikasi langsung cloud membutuhkan koneksi internet.", {
        judul: "Koneksi Terputus",
        bahaya: true
      });
    }
    return false;
  }

  if (sedangMemuat) return false;
  sedangMemuat = true;
  perbaruiStatusSync();

  try {
    let tokoRows = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");
    if (!Array.isArray(tokoRows) || tokoRows.length === 0) {
      const dibuat = await requestSupabase(
        "toko",
        "POST",
        TOKO_DEFAULT.map(nama => ({ nama }))
      );
      tokoRows = Array.isArray(dibuat) ? dibuat : [];
    }

    const barangRows = await requestSupabase("barang", "GET", null, "?select=*&order=id.asc");

    daftarToko = tokoRows.map(t => ({ id: t.id, nama: t.nama }));
    semuaBarangCache = (Array.isArray(barangRows) ? barangRows : []).map(normalisasiBarisBarangCloud);
    waktuSyncTerakhir = new Date().toISOString();

    await tampilkanBarang();
    sedangMemuat = false;
    perbaruiStatusSync(labelSukses);

    if (tampilkanPesan) {
      await tampilkanAlert("Data berhasil disinkronkan dengan Supabase.", {
        judul: "Sinkronisasi Berhasil"
      });
    }
    return true;
  } catch (err) {
    sedangMemuat = false;
    perbaruiStatusSync("Gagal sinkron");
    if (tampilkanPesan) {
      await tampilkanAlert(`Gagal menyinkronkan data dengan Supabase: ${err.message}`, {
        judul: "Gagal Sinkronisasi",
        bahaya: true
      });
    }
    return false;
  }
}

async function sinkronkanSekarang(tampilkanPesan = false) {
  return muatDataDariCloud(tampilkanPesan, "Tersinkron");
}

function lepasFokusAktif() {
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
}

function ambilLabelNamaKategori(kat = kategoriAktif) {
  return kat === "Pupuk" ? "Nama Pupuk" : "Nama Obat";
}

function sinkronkanFormKategori() {
  const selectKat = document.getElementById("kategori");
  const kat = selectKat ? selectKat.value : kategoriAktif;
  const isPupuk = kat === "Pupuk";

  const labelNamaModal = document.getElementById("label-nama-modal");
  const inputNama = document.getElementById("nama");
  if (labelNamaModal) {
    labelNamaModal.textContent = ambilLabelNamaKategori(kat);
  }
  if (inputNama) {
    inputNama.placeholder = isPupuk ? "Contoh: Urea" : "Contoh: Arjuna";
  }

  const wadahObat = document.getElementById("wadah-ukuran-obat");
  const inputObatAngka = document.getElementById("ukuran-obat-angka");
  const selectSatuanObat = document.getElementById("satuan-ukuran-obat");

  const wadahPupuk = document.getElementById("wadah-ukuran-pupuk");
  const inputPupukAngka = document.getElementById("ukuran-pupuk-angka");

  const wadahHargaJual = document.getElementById("wadah-harga-jual");
  const inputHargaJual = document.getElementById("hargaJual");

  const modalJudulInfo = document.getElementById("modal-judul-info");
  if (modalJudulInfo) {
    modalJudulInfo.textContent = isPupuk ? "Informasi Pupuk & Harga Jual" : "Informasi Obat";
  }

  if (isPupuk) {
    if (wadahObat) wadahObat.style.display = "none";
    if (inputObatAngka) inputObatAngka.disabled = true;
    if (selectSatuanObat) selectSatuanObat.disabled = true;

    if (wadahPupuk) wadahPupuk.style.display = "grid";
    if (inputPupukAngka) {
      inputPupukAngka.disabled = false;
      if (!inputPupukAngka.value && inputObatAngka && inputObatAngka.value) {
        inputPupukAngka.value = inputObatAngka.value;
      }
    }

    if (wadahHargaJual) wadahHargaJual.style.display = "block";
    if (inputHargaJual) inputHargaJual.disabled = false;
  } else {
    if (wadahPupuk) wadahPupuk.style.display = "none";
    if (inputPupukAngka) inputPupukAngka.disabled = true;

    if (wadahObat) wadahObat.style.display = "grid";
    if (inputObatAngka) {
      inputObatAngka.disabled = false;
      if (!inputObatAngka.value && inputPupukAngka && inputPupukAngka.value) {
        inputObatAngka.value = inputPupukAngka.value;
      }
    }
    if (selectSatuanObat) {
      selectSatuanObat.disabled = false;
      if (!selectSatuanObat.value) selectSatuanObat.value = "ml";
    }

    if (wadahHargaJual) wadahHargaJual.style.display = "none";
    if (inputHargaJual) {
      inputHargaJual.disabled = true;
      inputHargaJual.value = "";
    }
  }
}

function formatWaktu(isoString) {
  if (!isoString) return "-";
  const tgl = new Date(isoString);
  if (isNaN(tgl.getTime())) return String(isoString);
  return tgl.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function perbaruiModeTabelKategori() {
  const tabel = document.getElementById("tabel-utama");
  const kartu = document.getElementById("kartu-tabel-utama");
  const isPupuk = kategoriAktif === "Pupuk";

  if (tabel) {
    tabel.classList.remove("mode-kat-obat", "mode-kat-pupuk");
    tabel.classList.add(isPupuk ? "mode-kat-pupuk" : "mode-kat-obat");
  }
  if (kartu) {
    kartu.classList.toggle("tampil-pupuk", isPupuk);
  }
}

function buatTabKategori() {
  const tabContainer = document.getElementById("tab-kategori");
  if (!tabContainer) return;

  tabContainer.innerHTML = "";
  KATEGORI_STATIS.forEach(kat => {
    const isAktif = kategoriAktif === kat;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", isAktif ? "true" : "false");
    btn.className = `tab-btn${isAktif ? " aktif" : ""}`;
    btn.textContent = kat;
    btn.addEventListener("click", () => {
      gantiTabKategori(kat);
    });
    tabContainer.appendChild(btn);
  });

  const btnTambah = document.createElement("button");
  btnTambah.type = "button";
  btnTambah.className = "btn-tambah-tab";
  btnTambah.textContent = "+ Tambah";
  btnTambah.addEventListener("click", () => {
    bukaModalBarang();
  });
  tabContainer.appendChild(btnTambah);
}

function gantiTabKategori(nilaiKategori) {
  if (kategoriAktif === nilaiKategori) return;
  kategoriAktif = nilaiKategori;
  perbaruiModeTabelKategori();
  buatTabKategori();
  renderHeaderTabel();
  renderIsiTabel();
}

function formatInputRibuan(input) {
  const angkaMurni = input.value.replace(/\D/g, "");
  if (!angkaMurni) {
    input.value = "";
    return;
  }
  input.value = Number(angkaMurni).toLocaleString("id-ID");
}

function ambilAngkaMurni(nilai) {
  const bersih = String(nilai || "").replace(/\D/g, "");
  return bersih === "" ? NaN : parseInt(bersih, 10);
}

function formatRupiah(angka) {
  return "Rp " + Number(angka || 0).toLocaleString("id-ID");
}

function formatAngkaToko(angka) {
  return Number(angka || 0).toLocaleString("id-ID");
}

function escapeHtml(teks) {
  return String(teks || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kumpulkanDaftarPerubahan(dataLama, dataBaru) {
  const daftarPerubahan = [];

  if ((dataLama.nama || "").trim() !== (dataBaru.nama || "").trim()) {
    daftarPerubahan.push(`Nama dari "${dataLama.nama || "-"}" menjadi "${dataBaru.nama || "-"}"`);
  }
  const ukLama = susunUkuranGabungan(dataLama.ukuran, dataLama.kategori, dataLama.satuanUkuran);
  const ukBaru = susunUkuranGabungan(dataBaru.ukuran, dataBaru.kategori, dataBaru.satuanUkuran);
  if (ukLama !== ukBaru) {
    daftarPerubahan.push(`Ukuran dari "${ukLama}" menjadi "${ukBaru}"`);
  }
  if ((dataLama.kategori || "") !== (dataBaru.kategori || "")) {
    daftarPerubahan.push(`Kategori dari "${dataLama.kategori || "-"}" menjadi "${dataBaru.kategori || "-"}"`);
  }
  if (dataBaru.kategori === "Pupuk" && Number(dataLama.hargaJual || 0) !== Number(dataBaru.hargaJual || 0)) {
    daftarPerubahan.push(`Harga Jual dari ${formatRupiah(dataLama.hargaJual)} menjadi ${formatRupiah(dataBaru.hargaJual)}`);
  }

  const hargaTokoLama = dataLama.hargaToko || {};
  const hargaTokoBaru = dataBaru.hargaToko || {};
  daftarToko.forEach(t => {
    const lama = Number(hargaTokoLama[t.id] ?? hargaTokoLama[String(t.id)] ?? 0);
    const baru = Number(hargaTokoBaru[t.id] ?? hargaTokoBaru[String(t.id)] ?? 0);
    if (lama !== baru) {
      daftarPerubahan.push(`Harga ${t.nama} dari ${formatRupiah(lama)} menjadi ${formatRupiah(baru)}`);
    }
  });

  return daftarPerubahan;
}

function renderFormToko(nilaiHarga = {}) {
  const container = document.getElementById("input-harga-toko");
  container.innerHTML = "";

  daftarToko.forEach(t => {
    const raw = nilaiHarga[t.id] ?? nilaiHarga[String(t.id)];
    const val = raw !== undefined && raw !== null && raw !== ""
      ? Number(raw).toLocaleString("id-ID")
      : "";
    container.innerHTML += `
      <div class="toko-harga-box">
        <label for="toko-input-${t.id}">${escapeHtml(t.nama)}</label>
        <input type="text" inputmode="numeric" id="toko-input-${t.id}" data-toko-id="${t.id}"
               value="${val}" placeholder="Harga di ${escapeHtml(t.nama)}"
               oninput="formatInputRibuan(this)">
      </div>
    `;
  });
}

function bukaModalBarang() {
  idSedangDiedit = null;
  document.getElementById("judul-form-barang").textContent = "Tambah";
  document.getElementById("btn-simpan-barang").textContent = "Simpan";
  bersihkanFormBarang();
  renderFormToko({});
  sinkronkanFormKategori();
  lepasFokusAktif();
  document.getElementById("modal-barang").classList.add("aktif");
}

function tutupModalBarang() {
  idSedangDiedit = null;
  bersihkanFormBarang();
  lepasFokusAktif();
  document.getElementById("modal-barang").classList.remove("aktif");
}

function bersihkanFormBarang() {
  document.getElementById("nama").value = "";
  document.getElementById("ukuran-obat-angka").value = "";
  document.getElementById("satuan-ukuran-obat").value = "ml";
  document.getElementById("ukuran-pupuk-angka").value = "";
  document.getElementById("kategori").value = kategoriAktif;
  document.getElementById("hargaJual").value = "";
}

async function simpanBarang() {
  if (sedangMenyimpanBarang) return;

  const nama = document.getElementById("nama").value.trim();
  const kategori = document.getElementById("kategori").value === "Pupuk" ? "Pupuk" : "Obat";
  const isPupuk = kategori === "Pupuk";

  const satuanDipilih = isPupuk
    ? "sack"
    : (document.getElementById("satuan-ukuran-obat").value || "ml");
  const inputUkuranEl = isPupuk
    ? document.getElementById("ukuran-pupuk-angka")
    : document.getElementById("ukuran-obat-angka");
  bersihkanInputAngkaUkuran(inputUkuranEl);
  const inputUkuranMentah = inputUkuranEl ? inputUkuranEl.value : "";

  const ukuran = susunUkuranGabungan(inputUkuranMentah, kategori, satuanDipilih);
  const rawHargaJual = isPupuk ? ambilAngkaMurni(document.getElementById("hargaJual").value) : 0;
  const hargaJual = isNaN(rawHargaJual) ? 0 : rawHargaJual;

  if (!nama) {
    await tampilkanAlert("Mohon isi Nama terlebih dahulu.", {
      judul: "Nama Belum Diisi",
      bahaya: true
    });
    return;
  }

  const idTargetEdit = idSedangDiedit;
  const modeEdit = idTargetEdit !== null && idTargetEdit !== undefined && String(idTargetEdit) !== "";
  const detailSedangAktif = modeEdit && idDetailAktif !== null && String(idDetailAktif) === String(idTargetEdit);

  const duplikat = semuaBarangCache.find(b => {
    if (modeEdit && String(b.id) === String(idTargetEdit)) return false;
    const samaKategori = b.kategori === kategori;
    const samaNama = (b.nama || "").trim().toLowerCase() === nama.toLowerCase();
    const ukuranExisting = susunUkuranGabungan(b.ukuran, b.kategori, b.satuanUkuran);
    const samaUkuran = ukuranExisting.toLowerCase() === ukuran.toLowerCase();
    return samaKategori && samaNama && samaUkuran;
  });

  if (duplikat) {
    const labelItem = ambilLabelNamaKategori(kategori);
    await tampilkanAlert(
      `${labelItem} "${nama}" dengan ukuran "${ukuran}" sudah ada. Gunakan ukuran yang berbeda jika ingin menambah nama yang sama.`,
      { judul: "Data Sudah Ada", bahaya: true }
    );
    return;
  }

  const hargaToko = {};
  daftarToko.forEach(t => {
    const el = document.getElementById(`toko-input-${t.id}`);
    const angka = el ? ambilAngkaMurni(el.value) : 0;
    hargaToko[String(t.id)] = isNaN(angka) ? 0 : angka;
  });

  const waktuSekarang = new Date().toISOString();
  const btnSimpan = document.getElementById("btn-simpan-barang");

  sedangMenyimpanBarang = true;
  if (btnSimpan) btnSimpan.disabled = true;
  perbaruiStatusSync("Menyimpan...");

  try {
    if (modeEdit) {
      const dataLama = semuaBarangCache.find(b => String(b.id) === String(idTargetEdit)) || {};
      const daftarPerubahan = kumpulkanDaftarPerubahan(dataLama, {
        nama,
        kategori,
        ukuran,
        satuanUkuran: satuanDipilih,
        hargaJual,
        hargaToko
      });

      if (daftarPerubahan.length === 0) {
        sedangMenyimpanBarang = false;
        if (btnSimpan) btnSimpan.disabled = false;
        perbaruiStatusSync("Tersinkron");
        await tampilkanAlert("Tidak ada perubahan yang dilakukan.", {
          judul: "Tidak Ada Perubahan",
          teksOk: "Selesai",
          countdownDetik: 5,
          tutupModalBarangSaatSelesai: true
        });
        tutupModalBarang();
        return;
      }

      const dibuatPadaAwal = dataLama.dibuatPada || waktuSekarang;
      const riwayatLama = Array.isArray(dataLama.riwayatEdit) ? dataLama.riwayatEdit : [];

      const dataBaru = {
        nama,
        kategori,
        ukuran,
        satuanUkuran: satuanDipilih,
        hargaJual,
        hargaToko,
        dibuatPada: dibuatPadaAwal,
        dieditPada: waktuSekarang,
        riwayatEdit: [
          ...riwayatLama,
          {
            waktuEdit: waktuSekarang,
            keterangan: "Mengedit " + daftarPerubahan.join("; ")
          }
        ]
      };

      const payload = susunPayloadBarangCloud(dataBaru);
      const hasilPatch = await requestSupabase("barang", "PATCH", payload, `?id=eq.${encodeURIComponent(idTargetEdit)}`);
      const rowUpdated = Array.isArray(hasilPatch) && hasilPatch[0]
        ? normalisasiBarisBarangCloud(hasilPatch[0])
        : { ...dataBaru, id: idTargetEdit };

      semuaBarangCache = semuaBarangCache.map(b => String(b.id) === String(idTargetEdit) ? rowUpdated : b);
      waktuSyncTerakhir = waktuSekarang;
      kategoriAktif = kategori;
      await tampilkanBarang();
      perbaruiStatusSync("Tersinkron");

      if (detailSedangAktif) {
        await bukaDetail(idTargetEdit);
      }

      await tampilkanAlert(`Data ${nama} dengan ukuran ${ukuran} berhasil diperbarui.`, {
        judul: "Berhasil Diperbarui",
        teksOk: "Selesai",
        countdownDetik: 5,
        tutupModalBarangSaatSelesai: true
      });
      tutupModalBarang();
    } else {
      const dataBaru = {
        nama,
        kategori,
        ukuran,
        satuanUkuran: satuanDipilih,
        hargaJual,
        hargaToko,
        dibuatPada: waktuSekarang,
        dieditPada: null,
        riwayatEdit: []
      };

      const payload = susunPayloadBarangCloud(dataBaru);
      const hasilPost = await requestSupabase("barang", "POST", [payload]);
      const rowInserted = Array.isArray(hasilPost) && hasilPost[0]
        ? normalisasiBarisBarangCloud(hasilPost[0])
        : { ...dataBaru, id: Date.now() };

      semuaBarangCache = [...semuaBarangCache, rowInserted];
      waktuSyncTerakhir = waktuSekarang;
      kategoriAktif = kategori;
      await tampilkanBarang();
      perbaruiStatusSync("Tersinkron");

      await tampilkanAlert(`Data ${nama} dengan ukuran ${ukuran} sudah disimpan.`, {
        judul: "Berhasil Disimpan",
        teksOk: "Selesai",
        countdownDetik: 5,
        tutupModalBarangSaatSelesai: true
      });
      tutupModalBarang();
    }
  } catch (err) {
    perbaruiStatusSync("Gagal simpan");
    await tampilkanAlert(`Gagal menyimpan ke Supabase: ${err.message}`, {
      judul: "Gagal Menyimpan",
      bahaya: true
    });
  } finally {
    sedangMenyimpanBarang = false;
    if (btnSimpan) btnSimpan.disabled = false;
  }
}

function mulaiEdit(id) {
  const item = semuaBarangCache.find(b => String(b.id) === String(id));
  if (!item) return;

  idSedangDiedit = item.id;
  const katItem = item.kategori === "Pupuk" ? "Pupuk" : "Obat";
  const isPupuk = katItem === "Pupuk";
  const terurai = pisahkanUkuranDanSatuan(item.ukuran === "-" ? "" : item.ukuran, katItem, item.satuanUkuran);

  document.getElementById("judul-form-barang").textContent = "Edit";
  document.getElementById("btn-simpan-barang").textContent = "Update";
  document.getElementById("nama").value = item.nama;
  document.getElementById("kategori").value = katItem;

  if (isPupuk) {
    document.getElementById("ukuran-pupuk-angka").value = terurai.angka;
    document.getElementById("ukuran-obat-angka").value = "";
    document.getElementById("satuan-ukuran-obat").value = "ml";
    document.getElementById("hargaJual").value = Number(item.hargaJual || 0).toLocaleString("id-ID");
  } else {
    document.getElementById("ukuran-obat-angka").value = terurai.angka;
    document.getElementById("satuan-ukuran-obat").value = terurai.satuan || "ml";
    document.getElementById("ukuran-pupuk-angka").value = "";
    document.getElementById("hargaJual").value = "";
  }

  renderFormToko(item.hargaToko || {});
  sinkronkanFormKategori();
  lepasFokusAktif();
  document.getElementById("modal-barang").classList.add("aktif");
}

function renderHeaderTabel() {
  const header = document.getElementById("header-tabel");
  const labelNama = ambilLabelNamaKategori(kategoriAktif);
  const isPupuk = kategoriAktif === "Pupuk";

  let thHtml = `
    <th class="col-nama">${escapeHtml(labelNama)}</th>
    <th class="col-ukuran"><span class="teks-rata-kanan-kiri">Ukuran</span></th>
  `;
  if (isPupuk) {
    thHtml += `<th class="col-harga"><span class="teks-rata-kanan-kiri">Harga Jual <span class="header-ket-biasa">(Rp)</span></span></th>`;
  }
  daftarToko.forEach(t => {
    thHtml += `<th class="col-toko"><span class="teks-rata-kanan-kiri">${escapeHtml(t.nama)} <span class="header-ket-biasa">(Rp)</span></span></th>`;
  });
  thHtml += `<th class="col-aksi"><span class="teks-rata-kanan-kiri">Aksi</span></th>`;
  header.innerHTML = thHtml;
}

function renderIsiTabel() {
  const kataKunci = document.getElementById("cari").value.toLowerCase().trim();
  const hurufPilihan = (document.getElementById("filter-huruf").value || "").toLowerCase();
  const isPupuk = kategoriAktif === "Pupuk";
  const totalKolom = (isPupuk ? 3 : 2) + daftarToko.length + 1;

  let hasil = semuaBarangCache.filter(item => {
    const namaItem = (item.nama || "").trim();
    const cocokKategori = item.kategori === kategoriAktif;
    const cocokHuruf = !hurufPilihan || namaItem.toLowerCase().startsWith(hurufPilihan);
    const cocokCari = namaItem.toLowerCase().includes(kataKunci);
    return cocokKategori && cocokHuruf && cocokCari;
  });

  hasil.sort((a, b) => {
    const namaA = (a.nama || "").trim().toLowerCase();
    const namaB = (b.nama || "").trim().toLowerCase();
    if (namaA !== namaB) {
      return namaA < namaB ? -1 : 1;
    }
    const ukA = susunUkuranGabungan(a.ukuran, a.kategori, a.satuanUkuran).toLowerCase();
    const ukB = susunUkuranGabungan(b.ukuran, b.kategori, b.satuanUkuran).toLowerCase();
    if (ukA === ukB) return 0;
    return ukA < ukB ? -1 : 1;
  });

  const tbody = document.getElementById("tabel-barang");
  tbody.innerHTML = "";

  if (hasil.length === 0) {
    const infoHuruf = hurufPilihan ? ` dengan awalan "${hurufPilihan.toUpperCase()}"` : "";
    tbody.innerHTML = `
      <tr>
        <td colspan="${totalKolom}" style="text-align: center; color: #64748b; padding: 18px;">
          Belum ada data di tab "${escapeHtml(kategoriAktif)}"${infoHuruf}.
        </td>
      </tr>
    `;
    return;
  }

  hasil.forEach(item => {
    const hargaToko = item.hargaToko || {};
    const ukuranTampil = susunUkuranGabungan(item.ukuran, item.kategori, item.satuanUkuran);
    let tdTokoHtml = "";
    daftarToko.forEach(t => {
      tdTokoHtml += `<td class="col-toko">${formatAngkaToko(hargaToko[t.id] ?? hargaToko[String(t.id)])}</td>`;
    });

    const tdHargaJualHtml = isPupuk
      ? `<td class="col-harga"><strong>${formatAngkaToko(item.hargaJual)}</strong></td>`
      : "";

    tbody.innerHTML += `
      <tr class="baris-klik" onclick="bukaDetail('${escapeHtml(item.id)}')">
        <td class="col-nama"><strong>${escapeHtml(item.nama)}</strong></td>
        <td class="col-ukuran">${escapeHtml(ukuranTampil)}</td>
        ${tdHargaJualHtml}
        ${tdTokoHtml}
        <td class="col-aksi" onclick="event.stopPropagation()">
          <button type="button" class="btn-hapus btn-kecil" onclick="hapusBarang('${escapeHtml(item.id)}')">Hapus</button>
        </td>
      </tr>
    `;
  });
}

async function tampilkanBarang() {
  perbaruiModeTabelKategori();
  buatTabKategori();
  renderHeaderTabel();
  renderIsiTabel();
}

function renderLogWaktuDetail(item) {
  const logEl = document.getElementById("detail-log-waktu");
  if (!logEl) return;

  const riwayatEdit = Array.isArray(item.riwayatEdit) ? item.riwayatEdit : [];

  let rowsHtml = `
    <tr>
      <td>${escapeHtml(formatWaktu(item.dibuatPada))}</td>
      <td>-</td>
      <td>Data baru ditambahkan</td>
    </tr>
  `;

  riwayatEdit.forEach(entry => {
    rowsHtml += `
      <tr>
        <td>-</td>
        <td>${escapeHtml(formatWaktu(entry.waktuEdit))}</td>
        <td>${escapeHtml(entry.keterangan || "Data diedit")}</td>
      </tr>
    `;
  });

  logEl.innerHTML = `
    <div class="log-waktu-judul">Catatan Waktu Dibuat, Diedit &amp; Perubahan</div>
    <div class="log-waktu-scroll">
      <table class="tabel-log-waktu">
        <thead>
          <tr>
            <th>Waktu Dibuat</th>
            <th>Waktu Diedit</th>
            <th>Keterangan Perubahan</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function bukaDetail(id) {
  const item = semuaBarangCache.find(b => String(b.id) === String(id));
  if (!item) return;

  idDetailAktif = item.id;
  const katItem = item.kategori === "Pupuk" ? "Pupuk" : "Obat";
  const isPupuk = katItem === "Pupuk";
  const labelNama = ambilLabelNamaKategori(katItem);
  const ukuranTampil = susunUkuranGabungan(item.ukuran, katItem, item.satuanUkuran);
  const judulHeaderDetail = ukuranTampil && ukuranTampil !== "-"
    ? `${item.nama} (${ukuranTampil})`
    : item.nama;

  document.getElementById("halaman-utama").style.display = "none";
  document.getElementById("halaman-detail").style.display = "block";
  document.getElementById("detail-nama").textContent = judulHeaderDetail;

  const detailJudulInfo = document.getElementById("detail-judul-info");
  if (detailJudulInfo) {
    detailJudulInfo.textContent = isPupuk ? "Informasi Pupuk & Harga Jual" : "Informasi Obat";
  }

  const hargaJualBoxHtml = isPupuk
    ? `
      <div class="detail-box">
        <div class="detail-label">Harga Jual</div>
        <div class="detail-val">${formatRupiah(item.hargaJual)}</div>
      </div>
    `
    : "";

  document.getElementById("detail-info-utama").innerHTML = `
    <div class="detail-box">
      <div class="detail-label">${escapeHtml(labelNama)}</div>
      <div class="detail-val">${escapeHtml(item.nama)}</div>
    </div>
    <div class="detail-box">
      <div class="detail-label">Ukuran</div>
      <div class="detail-val">${escapeHtml(ukuranTampil)}</div>
    </div>
    ${hargaJualBoxHtml}
    <div class="detail-box">
      <div class="detail-label">Kategori</div>
      <div class="detail-val">${escapeHtml(katItem)}</div>
    </div>
  `;

  const hargaToko = item.hargaToko || {};
  let tokoBoxesHtml = "";
  daftarToko.forEach(t => {
    const nilaiToko = hargaToko[t.id] ?? hargaToko[String(t.id)] ?? 0;
    tokoBoxesHtml += `
      <div class="detail-box">
        <div class="detail-label">${escapeHtml(t.nama)}</div>
        <div class="detail-val">${formatRupiah(nilaiToko)}</div>
      </div>
    `;
  });
  document.getElementById("detail-harga-toko").innerHTML = tokoBoxesHtml;

  renderLogWaktuDetail(item);

  document.getElementById("detail-btn-hapus").onclick = async () => {
    const terhapus = await hapusBarang(item.id);
    if (terhapus) {
      tutupDetail();
    }
  };
}

function tutupDetail() {
  idDetailAktif = null;
  document.getElementById("halaman-detail").style.display = "none";
  document.getElementById("halaman-utama").style.display = "block";
}

function editDariDetail() {
  if (idDetailAktif !== null) {
    mulaiEdit(idDetailAktif);
  }
}

async function hapusBarang(id) {
  const targetItem = semuaBarangCache.find(b => String(b.id) === String(id));
  const namaItem = (targetItem && targetItem.nama) ? targetItem.nama : "Data";
  const ukuranItem = targetItem
    ? susunUkuranGabungan(targetItem.ukuran, targetItem.kategori, targetItem.satuanUkuran)
    : "-";

  const yakin = await tampilkanKonfirmasi("Hapus data ini secara permanen?", {
    judul: "Hapus Data",
    teksYa: "Hapus",
    teksBatal: "Batal",
    bahaya: true
  });
  if (!yakin) return false;

  const snapshotCache = [...semuaBarangCache];
  // Hapus langsung dari state & perbarui tabel seketika
  semuaBarangCache = semuaBarangCache.filter(b => String(b.id) !== String(id));
  renderIsiTabel();
  perbaruiStatusSync("Menghapus...");

  try {
    await requestSupabase("barang", "DELETE", null, `?id=eq.${encodeURIComponent(id)}`);
    waktuSyncTerakhir = new Date().toISOString();
    perbaruiStatusSync("Tersinkron");

    await tampilkanAlert(`${namaItem} dengan ukuran ${ukuranItem} sudah berhasil dihapus.`, {
      judul: "Berhasil Dihapus",
      teksOk: "Selesai",
      countdownDetik: 5,
      tutupModalBarangSaatSelesai: true
    });
    return true;
  } catch (err) {
    semuaBarangCache = snapshotCache;
    renderIsiTabel();
    perbaruiStatusSync("Gagal hapus");
    await tampilkanAlert(`Gagal menghapus data di Supabase: ${err.message}`, {
      judul: "Gagal Menghapus",
      bahaya: true
    });
    return false;
  }
}

function sinkronkanInputDraftToko() {
  const inputs = document.querySelectorAll(".input-nama-toko");
  inputs.forEach(inp => {
    const rawId = inp.getAttribute("data-id");
    const target = draftToko.find(t => String(t.id) === String(rawId));
    if (target) {
      target.nama = inp.value;
    }
  });
}

function adaTokoBaruBelumDisimpan() {
  return draftToko.some(t => t.isBaru === true);
}

function buatPesanKonfirmasiTokoBaru(namaBaruList) {
  const labelToko = namaBaruList.join(", ");
  const opsiPesan = [
    `Toko "${labelToko}" belum masuk ke tabel. Simpan sekarang?`,
    `Ada toko baru: ${labelToko}. Mau langsung ditampilkan di tabel?`,
    `Simpan toko "${labelToko}" ke tabel sebelum ditutup?`,
    `Toko ${labelToko} belum tersimpan. Masukkan ke tabel sekarang?`
  ];
  const pesan = opsiPesan[indexPesanKonfirmasi % opsiPesan.length];
  indexPesanKonfirmasi += 1;
  return pesan;
}

function bukaModalToko() {
  draftToko = daftarToko.map(t => ({ ...t, isBaru: false }));
  document.getElementById("nama-toko-baru").value = "";
  renderListEditToko();
  lepasFokusAktif();
  document.getElementById("modal-toko").classList.add("aktif");
}

function tutupModalTokoLangsung() {
  draftToko = [];
  document.getElementById("nama-toko-baru").value = "";
  lepasFokusAktif();
  document.getElementById("modal-toko").classList.remove("aktif");
}

async function tutupModalToko() {
  sinkronkanInputDraftToko();

  if (adaTokoBaruBelumDisimpan()) {
    const namaBaruList = draftToko
      .filter(t => t.isBaru)
      .map(t => (t.nama || "").trim() || "(Tanpa nama)");

    const inginSimpan = await tampilkanKonfirmasi(buatPesanKonfirmasiTokoBaru(namaBaruList), {
      judul: "Toko Baru Belum Disimpan",
      teksYa: "Simpan",
      teksBatal: "Buang"
    });

    if (inginSimpan) {
      await simpanPerubahanToko();
      return;
    }
  }

  tutupModalTokoLangsung();
}

function renderListEditToko() {
  const listEl = document.getElementById("list-edit-toko");
  listEl.innerHTML = "";

  draftToko.forEach(t => {
    listEl.innerHTML += `
      <div class="toko-row">
        <input type="text" class="input-nama-toko" data-id="${escapeHtml(t.id)}" value="${escapeHtml(t.nama)}">
        <button type="button" class="btn-hapus btn-kecil" onclick="hapusToko('${escapeHtml(t.id)}')">Hapus</button>
      </div>
    `;
  });
}

async function tambahTokoBaru() {
  sinkronkanInputDraftToko();
  const inputBaru = document.getElementById("nama-toko-baru");
  const nama = inputBaru.value.trim();
  if (!nama) {
    await tampilkanAlert("Masukkan nama toko terlebih dahulu.", {
      judul: "Nama Toko Kosong",
      bahaya: true
    });
    return;
  }

  draftToko.push({
    id: tempIdCounter--,
    nama,
    isBaru: true
  });
  inputBaru.value = "";
  renderListEditToko();
}

async function hapusToko(id) {
  sinkronkanInputDraftToko();
  if (draftToko.length <= 1) {
    await tampilkanAlert("Minimal harus ada 1 toko.", {
      judul: "Tidak Bisa Dihapus",
      bahaya: true
    });
    return;
  }

  const targetToko = draftToko.find(t => String(t.id) === String(id));
  const namaToko = (targetToko && targetToko.nama && targetToko.nama.trim()) || "toko ini";

  const itemBernilai = [];
  if (targetToko && !targetToko.isBaru) {
    semuaBarangCache.forEach(b => {
      const ht = b.hargaToko || {};
      const nilai = Number(ht[id] ?? ht[String(id)] ?? 0);
      if (nilai > 0) {
        const uk = susunUkuranGabungan(b.ukuran, b.kategori, b.satuanUkuran);
        const labelUk = uk && uk !== "-" ? ` (${uk})` : "";
        itemBernilai.push(`${b.nama || "Item"}${labelUk}: ${formatRupiah(nilai)}`);
      }
    });
  }

  if (itemBernilai.length > 0) {
    const daftarRingkas = itemBernilai.slice(0, 8).join("\n• ");
    const sisaCount = itemBernilai.length > 8 ? `\n• ...dan ${itemBernilai.length - 8} item lainnya` : "";
    const yakin = await tampilkanKonfirmasi(
      `Di ${namaToko} masih ada data harga yang tersimpan:\n• ${daftarRingkas}${sisaCount}\n\nApakah ingin benar-benar dihapus toko ini?`,
      {
        judul: "Masih Ada Data Harga",
        teksYa: "Hapus",
        teksBatal: "Batal",
        bahaya: true
      }
    );
    if (!yakin) return;
  } else {
    const yakin = await tampilkanKonfirmasi(`Hapus ${namaToko} dari daftar?`, {
      judul: "Hapus Toko",
      teksYa: "Hapus",
      teksBatal: "Batal",
      bahaya: true
    });
    if (!yakin) return;
  }

  draftToko = draftToko.filter(t => String(t.id) !== String(id));
  renderListEditToko();
}

async function simpanPerubahanToko() {
  sinkronkanInputDraftToko();

  const idDraftAktif = new Set(draftToko.filter(t => !t.isBaru).map(t => String(t.id)));
  const tokoTerhapus = daftarToko.filter(lama => !idDraftAktif.has(String(lama.id)));

  try {
    sedangMemuat = true;
    perbaruiStatusSync("Menyimpan toko...");

    for (const lama of tokoTerhapus) {
      await requestSupabase("toko", "DELETE", null, `?id=eq.${encodeURIComponent(lama.id)}`);
    }

    for (const item of draftToko) {
      const namaBersih = (item.nama || "").trim();
      if (!namaBersih) continue;

      if (!item.isBaru) {
        await requestSupabase("toko", "PATCH", { nama: namaBersih }, `?id=eq.${encodeURIComponent(item.id)}`);
      } else {
        await requestSupabase("toko", "POST", [{ nama: namaBersih }]);
      }
    }

    if (tokoTerhapus.length > 0) {
      const idsDihapus = new Set(tokoTerhapus.map(t => String(t.id)));
      for (const b of semuaBarangCache) {
        const rawHt = b.hargaToko || {};
        let berubah = false;
        const htBersih = {};
        Object.keys(rawHt).forEach(k => {
          if (idsDihapus.has(String(k))) {
            berubah = true;
          } else {
            htBersih[k] = rawHt[k];
          }
        });
        if (berubah && b.id !== undefined) {
          await requestSupabase("barang", "PATCH", { harga_toko: htBersih }, `?id=eq.${encodeURIComponent(b.id)}`);
        }
      }
    }

    tutupModalTokoLangsung();
    sedangMemuat = false;
    await muatDataDariCloud(false, "Tersinkron");

    await tampilkanAlert("Perubahan toko berhasil disimpan.", {
      judul: "Berhasil Disimpan",
      teksOk: "Selesai",
      countdownDetik: 5
    });
  } catch (err) {
    sedangMemuat = false;
    perbaruiStatusSync("Gagal simpan");
    await tampilkanAlert(`Gagal menyimpan perubahan toko ke Supabase: ${err.message}`, {
      judul: "Gagal Menyimpan Toko",
      bahaya: true
    });
  }
}

async function inisialisasiAplikasi() {
  if (!cloudSudahDiatur()) {
    tampilkanHalamanLogin("Konfigurasi Supabase (CLOUD_DEFAULT) belum diisi di app.js.");
    return;
  }

  const sesi = await refreshTokenJikaPerlu();
  if (!sesi || !sesi.access_token) {
    tampilkanHalamanLogin("");
    return;
  }

  tampilkanHalamanAplikasi();
  await muatDataDariCloud(false, "Tersinkron");
  mulaiSinkronOtomatisLimaMenit();
}

window.addEventListener("online", () => {
  perbaruiStatusSync("Online");
  if (cloudSudahDiatur() && muatSesiAuth()) {
    muatDataDariCloud(false, "Tersinkron");
  }
});

window.addEventListener("offline", () => {
  perbaruiStatusSync("Offline");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

inisialisasiAplikasi();
