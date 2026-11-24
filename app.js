const KATEGORI_STATIS = ["Obat", "Pupuk"];
const TOKO_DEFAULT = ["Toko A", "Toko B"];
const STORAGE_KEY_CLOUD = "inci_tani_cloud_config_v1";
const STORAGE_KEY_SESSION = "inci_tani_auth_session_v1";

// Isi dengan Project URL dan Publishable / anon key dari Supabase kamu
const CLOUD_DEFAULT = {
  url: "",
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
let sesiAuth = null;

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
      cloudTeks = "<strong>Memuat data...</strong>";
    } else if (!online) {
      cloudTeks = "<strong>Offline</strong> (butuh internet)";
    } else if (labelStatus) {
      cloudTeks = `<strong>${escapeHtml(labelStatus)}</strong>`;
    } else {
      cloudTeks = "<strong>Terhubung</strong>";
    }
  }

  const waktuTeks = waktuSyncTerakhir
    ? ` &bull; Terakhir: ${escapeHtml(formatWaktu(waktuSyncTerakhir))}`
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

function normalisasiBarisBarangCloud(row) {
  const kat = row.kategori === "Pupuk" ? "Pupuk" : "Obat";
  const satuanUkuran = kat === "Pupuk"
    ? ((row.satuan_ukuran || row.satuanUkuran) === "sack" ? "sack" : "kg")
    : null;

  return {
    id: row.id,
    nama: row.nama || "",
    kategori: kat,
    ukuran: normalisasiUkuran(row.ukuran, kat, satuanUkuran || "kg"),
    satuanUkuran,
    hargaJual: Number(row.harga_jual ?? row.hargaJual ?? 0),
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

  return {
    nama: data.nama,
    kategori: data.kategori,
    ukuran: data.ukuran,
    satuan_ukuran: data.satuanUkuran || null,
    harga_jual: Number(data.hargaJual || 0),
    harga_toko: hargaTokoClean,
    dibuat_pada: data.dibuatPada || new Date().toISOString(),
    diedit_pada: data.dieditPada || null,
    riwayat_edit: Array.isArray(data.riwayatEdit) ? data.riwayatEdit : []
  };
}

async function muatDataDariCloud(tampilkanPesan = false) {
  if (!cloudSudahDiatur()) {
    perbaruiStatusSync();
    if (tampilkanPesan) {
      alert("Konfigurasi Supabase (CLOUD_DEFAULT) belum diisi di app.js.");
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
      alert("Perangkat sedang offline. Aplikasi langsung cloud membutuhkan koneksi internet.");
    }
    return false;
  }

  if (sedangMemuat) return false;
  sedangMemuat = true;
  perbaruiStatusSync("Memuat data...");

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
    perbaruiStatusSync("Tersinkron");

    if (tampilkanPesan) {
      alert("Data berhasil dimuat dari Supabase.");
    }
    return true;
  } catch (err) {
    perbaruiStatusSync("Gagal memuat");
    if (tampilkanPesan) {
      alert(`Gagal memuat data dari Supabase: ${err.message}`);
    }
    return false;
  } finally {
    sedangMemuat = false;
  }
}

async function sinkronkanSekarang(tampilkanPesan = false) {
  return muatDataDariCloud(tampilkanPesan);
}

function lepasFokusAktif() {
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
}

function ambilLabelNamaKategori(kat = kategoriAktif) {
  return kat === "Pupuk" ? "Nama Pupuk" : "Nama Obat";
}

function gabungkanUkuranDanSatuan(nilaiUkuran, satuan = "") {
  const bersih = String(nilaiUkuran || "").trim();
  if (!bersih || bersih === "-") return "-";
  const sat = String(satuan || "").trim();
  if (!sat) return bersih;

  const lowerBersih = bersih.toLowerCase();
  const lowerSat = sat.toLowerCase();
  if (lowerBersih.endsWith(lowerSat)) {
    const angkaSaja = bersih.slice(0, bersih.length - sat.length).trim();
    return angkaSaja ? `${angkaSaja}${sat}` : bersih;
  }
  return `${bersih}${sat}`;
}

function pisahkanUkuranDanSatuanPupuk(ukuranTersimpan, satuanTersimpan = "") {
  const raw = String(ukuranTersimpan || "").trim();
  if (!raw || raw === "-") {
    return {
      angka: "",
      satuan: satuanTersimpan === "sack" ? "sack" : "kg"
    };
  }
  const match = raw.match(/^(.+?)\s*(kg|sack)$/i);
  if (match) {
    return {
      angka: match[1].trim(),
      satuan: match[2].toLowerCase()
    };
  }
  return {
    angka: raw,
    satuan: satuanTersimpan === "sack" ? "sack" : "kg"
  };
}

function normalisasiUkuran(uk, kategori = "Obat", satuanPupuk = "kg") {
  if (kategori === "Pupuk") {
    const { angka, satuan } = pisahkanUkuranDanSatuanPupuk(uk, satuanPupuk);
    const satDipakai = satuan === "sack" ? "sack" : "kg";
    if (!angka) return "-";
    return gabungkanUkuranDanSatuan(angka, satDipakai);
  }
  const bersih = String(uk || "").trim();
  return bersih === "" ? "-" : bersih;
}

function sinkronkanFormPupuk() {
  const selectKat = document.getElementById("kategori");
  const kat = selectKat ? selectKat.value : kategoriAktif;
  const isPupuk = kat === "Pupuk";

  const wadahPupuk = document.getElementById("wadah-ukuran-pupuk");
  const inputBiasa = document.getElementById("ukuran");
  const inputPupukAngka = document.getElementById("ukuran-pupuk-angka");
  const selectSatuanPupuk = document.getElementById("satuan-ukuran-pupuk");

  if (isPupuk) {
    if (wadahPupuk) wadahPupuk.style.display = "grid";
    if (inputPupukAngka) inputPupukAngka.disabled = false;
    if (selectSatuanPupuk) selectSatuanPupuk.disabled = false;
    if (inputBiasa) {
      inputBiasa.style.display = "none";
      inputBiasa.disabled = true;
      if (inputPupukAngka && inputBiasa.value && !inputPupukAngka.value) {
        const parsed = pisahkanUkuranDanSatuanPupuk(inputBiasa.value);
        inputPupukAngka.value = parsed.angka;
      }
    }
  } else {
    if (wadahPupuk) wadahPupuk.style.display = "none";
    if (inputPupukAngka) inputPupukAngka.disabled = true;
    if (selectSatuanPupuk) selectSatuanPupuk.disabled = true;
    if (inputBiasa) {
      inputBiasa.style.display = "block";
      inputBiasa.disabled = false;
      if (inputPupukAngka && inputPupukAngka.value && !inputBiasa.value) {
        inputBiasa.value = inputPupukAngka.value;
      }
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

function susunKeteranganPerubahan(dataLama, dataBaru) {
  const daftarPerubahan = [];

  if ((dataLama.nama || "").trim() !== (dataBaru.nama || "").trim()) {
    daftarPerubahan.push(`Nama dari "${dataLama.nama || "-"}" menjadi "${dataBaru.nama || "-"}"`);
  }
  if (normalisasiUkuran(dataLama.ukuran, dataLama.kategori, dataLama.satuanUkuran) !== normalisasiUkuran(dataBaru.ukuran, dataBaru.kategori, dataBaru.satuanUkuran)) {
    daftarPerubahan.push(`Ukuran dari "${dataLama.ukuran || "-"}" menjadi "${dataBaru.ukuran || "-"}"`);
  }
  if ((dataLama.kategori || "") !== (dataBaru.kategori || "")) {
    daftarPerubahan.push(`Kategori dari "${dataLama.kategori || "-"}" menjadi "${dataBaru.kategori || "-"}"`);
  }
  if (Number(dataLama.hargaJual || 0) !== Number(dataBaru.hargaJual || 0)) {
    daftarPerubahan.push(`Harga Jual dari ${formatRupiah(dataLama.hargaJual)} menjadi ${formatRupiah(dataBaru.hargaJual)}`);
  }

  const hargaTokoLama = dataLama.hargaToko || {};
  const hargaTokoBaru = dataBaru.hargaToko || {};
  daftarToko.forEach(t => {
    const lama = Number(hargaTokoLama[t.id] || hargaTokoLama[String(t.id)] || 0);
    const baru = Number(hargaTokoBaru[t.id] || hargaTokoBaru[String(t.id)] || 0);
    if (lama !== baru) {
      daftarPerubahan.push(`Harga ${t.nama} dari ${formatRupiah(lama)} menjadi ${formatRupiah(baru)}`);
    }
  });

  if (daftarPerubahan.length === 0) {
    return "Data diperbarui (tidak ada perubahan nilai)";
  }
  return "Mengedit " + daftarPerubahan.join("; ");
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
  document.getElementById("judul-form-barang").textContent = "Tambah Barang";
  document.getElementById("btn-simpan-barang").textContent = "Simpan Barang";
  bersihkanFormBarang();
  renderFormToko({});
  sinkronkanFormPupuk();
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
  document.getElementById("ukuran").value = "";
  document.getElementById("ukuran-pupuk-angka").value = "";
  document.getElementById("satuan-ukuran-pupuk").value = "kg";
  document.getElementById("kategori").value = kategoriAktif;
  document.getElementById("hargaJual").value = "";
}

async function simpanBarang() {
  const nama = document.getElementById("nama").value.trim();
  const kategori = document.getElementById("kategori").value;
  const satuanPupuk = document.getElementById("satuan-ukuran-pupuk").value || "kg";
  const inputUkuranMentah = kategori === "Pupuk"
    ? document.getElementById("ukuran-pupuk-angka").value
    : document.getElementById("ukuran").value;
  const ukuran = normalisasiUkuran(inputUkuranMentah, kategori, satuanPupuk);
  const hargaJual = ambilAngkaMurni(document.getElementById("hargaJual").value);

  if (!nama || isNaN(hargaJual)) {
    alert("Mohon isi minimal Nama Barang dan Harga Jual.");
    return;
  }

  const duplikat = semuaBarangCache.find(b => {
    if (idSedangDiedit !== null && String(b.id) === String(idSedangDiedit)) return false;
    const samaKategori = b.kategori === kategori;
    const samaNama = (b.nama || "").trim().toLowerCase() === nama.toLowerCase();
    const ukuranExisting = normalisasiUkuran(b.ukuran, b.kategori, b.satuanUkuran);
    const samaUkuran = ukuranExisting.toLowerCase() === ukuran.toLowerCase();
    return samaKategori && samaNama && samaUkuran;
  });

  if (duplikat) {
    const labelItem = ambilLabelNamaKategori(kategori);
    alert(`${labelItem} "${nama}" dengan ukuran "${ukuran}" sudah ada. Gunakan ukuran yang berbeda jika ingin menambah nama yang sama.`);
    return;
  }

  const hargaToko = {};
  daftarToko.forEach(t => {
    const el = document.getElementById(`toko-input-${t.id}`);
    const angka = el ? ambilAngkaMurni(el.value) : 0;
    hargaToko[String(t.id)] = isNaN(angka) ? 0 : angka;
  });

  const waktuSekarang = new Date().toISOString();
  const satuanUkuranSimpan = kategori === "Pupuk" ? satuanPupuk : null;
  const idTargetEdit = idSedangDiedit;
  const detailSedangAktif = idDetailAktif !== null && String(idDetailAktif) === String(idTargetEdit);

  try {
    sedangMemuat = true;
    perbaruiStatusSync("Menyimpan...");

    if (idTargetEdit !== null) {
      const dataLama = semuaBarangCache.find(b => String(b.id) === String(idTargetEdit)) || {};
      const dibuatPadaAwal = dataLama.dibuatPada || waktuSekarang;
      const riwayatLama = Array.isArray(dataLama.riwayatEdit) ? dataLama.riwayatEdit : [];

      const dataBaru = {
        nama,
        kategori,
        ukuran,
        satuanUkuran: satuanUkuranSimpan,
        hargaJual,
        hargaToko,
        dibuatPada: dibuatPadaAwal,
        dieditPada: waktuSekarang,
        riwayatEdit: [
          ...riwayatLama,
          {
            waktuEdit: waktuSekarang,
            keterangan: susunKeteranganPerubahan(dataLama, {
              nama,
              kategori,
              ukuran,
              satuanUkuran: satuanUkuranSimpan,
              hargaJual,
              hargaToko
            })
          }
        ]
      };

      const payload = susunPayloadBarangCloud(dataBaru);
      await requestSupabase("barang", "PATCH", payload, `?id=eq.${encodeURIComponent(idTargetEdit)}`);
      tutupModalBarang();
      kategoriAktif = kategori;
      sedangMemuat = false;
      await muatDataDariCloud(false);

      if (detailSedangAktif) {
        await bukaDetail(idTargetEdit);
      }
    } else {
      const dataBaru = {
        nama,
        kategori,
        ukuran,
        satuanUkuran: satuanUkuranSimpan,
        hargaJual,
        hargaToko,
        dibuatPada: waktuSekarang,
        dieditPada: null,
        riwayatEdit: []
      };

      const payload = susunPayloadBarangCloud(dataBaru);
      await requestSupabase("barang", "POST", [payload]);
      tutupModalBarang();
      kategoriAktif = kategori;
      sedangMemuat = false;
      await muatDataDariCloud(false);
    }
  } catch (err) {
    sedangMemuat = false;
    perbaruiStatusSync("Gagal simpan");
    alert(`Gagal menyimpan ke Supabase: ${err.message}`);
  }
}

function mulaiEdit(id) {
  const item = semuaBarangCache.find(b => String(b.id) === String(id));
  if (!item) return;

  idSedangDiedit = item.id;
  const katItem = item.kategori || KATEGORI_STATIS[0];
  document.getElementById("judul-form-barang").textContent = "Edit";
  document.getElementById("btn-simpan-barang").textContent = "Update Barang";
  document.getElementById("nama").value = item.nama;
  document.getElementById("kategori").value = katItem;

  if (katItem === "Pupuk") {
    const parsed = pisahkanUkuranDanSatuanPupuk(item.ukuran === "-" ? "" : item.ukuran, item.satuanUkuran);
    document.getElementById("ukuran-pupuk-angka").value = parsed.angka;
    document.getElementById("satuan-ukuran-pupuk").value = parsed.satuan;
    document.getElementById("ukuran").value = parsed.angka;
  } else {
    document.getElementById("ukuran").value = item.ukuran === "-" ? "" : item.ukuran;
    document.getElementById("ukuran-pupuk-angka").value = "";
    document.getElementById("satuan-ukuran-pupuk").value = "kg";
  }

  document.getElementById("hargaJual").value = Number(item.hargaJual || 0).toLocaleString("id-ID");

  renderFormToko(item.hargaToko || {});
  sinkronkanFormPupuk();
  lepasFokusAktif();
  document.getElementById("modal-barang").classList.add("aktif");
}

function renderHeaderTabel() {
  const header = document.getElementById("header-tabel");
  const labelNama = ambilLabelNamaKategori(kategoriAktif);
  const labelUkuran = kategoriAktif === "Obat"
    ? `Ukuran <span class="header-ket-biasa">(ml/gram)</span>`
    : "Ukuran";

  let thHtml = `
    <th class="col-nama">${escapeHtml(labelNama)}</th>
    <th class="col-ukuran"><span class="teks-rata-kanan-kiri">${labelUkuran}</span></th>
    <th class="col-harga"><span class="teks-rata-kanan-kiri">Harga Jual <span class="header-ket-biasa">(Rp)</span></span></th>
  `;
  daftarToko.forEach(t => {
    thHtml += `<th class="col-toko"><span class="teks-rata-kanan-kiri">${escapeHtml(t.nama)} <span class="header-ket-biasa">(Rp)</span></span></th>`;
  });
  thHtml += `<th class="col-aksi"><span class="teks-rata-kanan-kiri">Aksi</span></th>`;
  header.innerHTML = thHtml;
}

function renderIsiTabel() {
  const kataKunci = document.getElementById("cari").value.toLowerCase().trim();
  const hurufPilihan = (document.getElementById("filter-huruf").value || "").toLowerCase();
  const totalKolom = 3 + daftarToko.length + 1;

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
    const ukA = normalisasiUkuran(a.ukuran, a.kategori, a.satuanUkuran).toLowerCase();
    const ukB = normalisasiUkuran(b.ukuran, b.kategori, b.satuanUkuran).toLowerCase();
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
          Belum ada barang di tab "${escapeHtml(kategoriAktif)}"${infoHuruf}.
        </td>
      </tr>
    `;
    return;
  }

  hasil.forEach(item => {
    const hargaToko = item.hargaToko || {};
    const ukuranTampil = normalisasiUkuran(item.ukuran, item.kategori, item.satuanUkuran);
    let tdTokoHtml = "";
    daftarToko.forEach(t => {
      tdTokoHtml += `<td class="col-toko">${formatAngkaToko(hargaToko[t.id] ?? hargaToko[String(t.id)])}</td>`;
    });

    tbody.innerHTML += `
      <tr class="baris-klik" onclick="bukaDetail('${escapeHtml(item.id)}')">
        <td class="col-nama"><strong>${escapeHtml(item.nama)}</strong></td>
        <td class="col-ukuran">${escapeHtml(ukuranTampil)}</td>
        <td class="col-harga"><strong>${formatAngkaToko(item.hargaJual)}</strong></td>
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
  const katItem = item.kategori || KATEGORI_STATIS[0];
  const labelNama = ambilLabelNamaKategori(katItem);
  const ukuranTampil = normalisasiUkuran(item.ukuran, katItem, item.satuanUkuran);

  document.getElementById("halaman-utama").style.display = "none";
  document.getElementById("halaman-detail").style.display = "block";
  document.getElementById("detail-nama").textContent = item.nama;

  document.getElementById("detail-info-utama").innerHTML = `
    <div class="detail-box">
      <div class="detail-label">${escapeHtml(labelNama)}</div>
      <div class="detail-val">${escapeHtml(item.nama)}</div>
    </div>
    <div class="detail-box">
      <div class="detail-label">Kategori</div>
      <div class="detail-val">${escapeHtml(katItem)}</div>
    </div>
    <div class="detail-box">
      <div class="detail-label">Ukuran</div>
      <div class="detail-val">${escapeHtml(ukuranTampil)}</div>
    </div>
    <div class="detail-box">
      <div class="detail-label">Harga Jual</div>
      <div class="detail-val">${formatRupiah(item.hargaJual)}</div>
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
  if (!confirm("Hapus barang ini?")) return false;

  try {
    sedangMemuat = true;
    perbaruiStatusSync("Menghapus...");
    await requestSupabase("barang", "DELETE", null, `?id=eq.${encodeURIComponent(id)}`);
    sedangMemuat = false;
    await muatDataDariCloud(false);
    return true;
  } catch (err) {
    sedangMemuat = false;
    perbaruiStatusSync("Gagal hapus");
    alert(`Gagal menghapus barang di Supabase: ${err.message}`);
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
  return `${pesan}\n(Oke = Simpan | Batal = Buang)`;
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

    const inginSimpan = confirm(buatPesanKonfirmasiTokoBaru(namaBaruList));

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

function tambahTokoBaru() {
  sinkronkanInputDraftToko();
  const inputBaru = document.getElementById("nama-toko-baru");
  const nama = inputBaru.value.trim();
  if (!nama) {
    alert("Masukkan nama toko terlebih dahulu.");
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

function hapusToko(id) {
  sinkronkanInputDraftToko();
  if (draftToko.length <= 1) {
    alert("Minimal harus ada 1 toko.");
    return;
  }
  if (!confirm("Hapus toko ini dari daftar?")) return;
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
    await muatDataDariCloud(false);
  } catch (err) {
    sedangMemuat = false;
    perbaruiStatusSync("Gagal simpan");
    alert(`Gagal menyimpan perubahan toko ke Supabase: ${err.message}`);
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
  await muatDataDariCloud(false);
}

window.addEventListener("online", () => {
  perbaruiStatusSync("Online");
  if (cloudSudahDiatur() && muatSesiAuth()) {
    muatDataDariCloud(false);
  }
});

window.addEventListener("offline", () => {
  perbaruiStatusSync("Offline");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

inisialisasiAplikasi();
