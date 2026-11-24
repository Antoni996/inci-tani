const db = new Dexie("DatabaseHargaTokoV2");
db.version(2).stores({
  barang: "++id, nama, kategori, ukuran, hargaJual, dibuatPada, dieditPada",
  toko: "++id, nama"
});

const KATEGORI_STATIS = ["Obat", "Pupuk"];
const TOKO_DEFAULT = ["Toko A", "Toko B"];
const STORAGE_KEY_CLOUD = "inci_tani_cloud_config_v1";

// Isi langsung di sini agar semua HP otomatis terhubung ke database cloud yang sama
const CLOUD_DEFAULT = {
  url: "https://svcsyhuvmwvtymareyxu.supabase.co/",
  anonKey: "sb_publishable_0H2j4ltoC9aqs25kDhFohw_hC6oOg7a"
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
let sedangSinkron = false;

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

function perbaruiStatusSync(labelStatus = null) {
  const el = document.getElementById("status-sync-teks");
  if (!el) return;

  const online = navigator.onLine;
  const terhubung = cloudSudahDiatur();

  let cloudTeks = "<strong>Belum diatur</strong>";
  if (terhubung) {
    if (sedangSinkron) {
      cloudTeks = "<strong>Sedang sinkron...</strong>";
    } else if (!online) {
      cloudTeks = "<strong>Offline</strong> (menunggu internet)";
    } else if (labelStatus) {
      cloudTeks = `<strong>${escapeHtml(labelStatus)}</strong>`;
    } else {
      cloudTeks = "<strong>Terhubung</strong>";
    }
  }

  const waktuTeks = waktuSyncTerakhir
    ? ` &bull; Terakhir: ${escapeHtml(formatWaktu(waktuSyncTerakhir))}`
    : "";

  el.innerHTML = `Lokal: <strong>Aktif</strong> &bull; Cloud: ${cloudTeks}${waktuTeks}`;
}

async function requestSupabase(tabel, method = "GET", body = null, query = "") {
  const cfg = ambilKonfigurasiCloud();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Konfigurasi cloud belum diatur.");
  }

  const endpoint = `${cfg.url}/rest/v1/${tabel}${query}`;
  const headers = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (!res.ok) {
    const detailError = await res.text();
    throw new Error(`HTTP ${res.status}: ${detailError || "Gagal terhubung ke cloud"}`);
  }

  if (res.status === 204) return [];
  const teks = await res.text();
  return teks ? JSON.parse(teks) : [];
}

function kunciUnikBarang(b) {
  const kat = b.kategori === "Pupuk" ? "Pupuk" : "Obat";
  const nama = String(b.nama || "").trim().toLowerCase();
  const uk = normalisasiUkuran(b.ukuran, kat, b.satuanUkuran || b.satuan_ukuran || "kg").toLowerCase();
  return `${kat}::${nama}::${uk}`;
}

function timestampItem(item) {
  const kandidat = item.dieditPada || item.diedit_pada || item.dibuatPada || item.dibuat_pada || "";
  const t = new Date(kandidat).getTime();
  return isNaN(t) ? 0 : t;
}

function susunPayloadBarangCloud(item, pemetaanIdLokalKeCloud = {}) {
  const rawHargaToko = item.hargaToko || item.harga_toko || {};
  const hargaTokoCloud = {};
  Object.keys(rawHargaToko).forEach(k => {
    const idCloud = pemetaanIdLokalKeCloud[String(k)] || k;
    hargaTokoCloud[String(idCloud)] = Number(rawHargaToko[k] || 0);
  });

  return {
    nama: item.nama,
    kategori: item.kategori,
    ukuran: item.ukuran,
    satuan_ukuran: item.satuanUkuran || item.satuan_ukuran || null,
    harga_jual: Number(item.hargaJual ?? item.harga_jual ?? 0),
    harga_toko: hargaTokoCloud,
    dibuat_pada: item.dibuatPada || item.dibuat_pada || new Date().toISOString(),
    diedit_pada: item.dieditPada || item.diedit_pada || null,
    riwayat_edit: Array.isArray(item.riwayatEdit || item.riwayat_edit)
      ? (item.riwayatEdit || item.riwayat_edit)
      : []
  };
}

async function muatUlangDariCloudKeLokal() {
  const tokoCloud = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");
  const barangCloud = await requestSupabase("barang", "GET", null, "?select=*&order=id.asc");

  await db.transaction("rw", db.toko, db.barang, async () => {
    await db.toko.clear();
    await db.barang.clear();

    const pemetaanIdCloudKeLokal = {};
    for (const tc of tokoCloud) {
      const idLokBaru = await db.toko.add({ nama: tc.nama });
      if (tc.id !== undefined && tc.id !== null) {
        pemetaanIdCloudKeLokal[String(tc.id)] = idLokBaru;
      }
    }

    for (const row of barangCloud) {
      const kat = row.kategori === "Pupuk" ? "Pupuk" : "Obat";
      const satuanUkuran = kat === "Pupuk"
        ? ((row.satuan_ukuran || row.satuanUkuran) === "sack" ? "sack" : "kg")
        : null;
      const rawHargaToko = row.harga_toko || row.hargaToko || {};
      const hargaTokoLokal = {};
      Object.keys(rawHargaToko).forEach(idCloud => {
        const idLok = pemetaanIdCloudKeLokal[String(idCloud)] || idCloud;
        hargaTokoLokal[idLok] = Number(rawHargaToko[idCloud] || 0);
      });

      await db.barang.add({
        nama: row.nama,
        kategori: kat,
        ukuran: normalisasiUkuran(row.ukuran, kat, satuanUkuran || "kg"),
        satuanUkuran,
        hargaJual: Number(row.harga_jual ?? row.hargaJual ?? 0),
        hargaToko: hargaTokoLokal,
        dibuatPada: row.dibuat_pada || row.dibuatPada || new Date().toISOString(),
        dieditPada: row.diedit_pada || row.dieditPada || null,
        riwayatEdit: Array.isArray(row.riwayat_edit || row.riwayatEdit)
          ? (row.riwayat_edit || row.riwayatEdit)
          : []
      });
    }
  });

  daftarToko = await db.toko.toArray();
  waktuSyncTerakhir = new Date().toISOString();
  await tampilkanBarang();
  perbaruiStatusSync("Tersinkron");
}

// Sinkronisasi dua arah antara IndexedDB (lokal) dan Supabase (cloud)
async function sinkronkanSekarang(tampilkanPesan = false) {
  if (!cloudSudahDiatur()) {
    perbaruiStatusSync();
    if (tampilkanPesan) {
      alert("Konfigurasi cloud belum diisi di CLOUD_DEFAULT pada app.js.");
    }
    return false;
  }

  if (!navigator.onLine) {
    perbaruiStatusSync("Offline");
    if (tampilkanPesan) {
      alert("Perangkat sedang offline. Data tetap aman di memori lokal dan akan disinkronkan saat internet tersedia.");
    }
    return false;
  }

  if (sedangSinkron) return false;
  sedangSinkron = true;
  perbaruiStatusSync("Sedang sinkron...");

  try {
    const tokoLokal = await db.toko.toArray();
    const barangLokal = await db.barang.toArray();

    const tokoCloud = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");
    const barangCloud = await requestSupabase("barang", "GET", null, "?select=*&order=id.asc");

    const petaNamaToko = new Map();
    tokoCloud.forEach(tc => {
      const namaNorm = String(tc.nama || "").trim().toLowerCase();
      if (namaNorm && !petaNamaToko.has(namaNorm)) {
        petaNamaToko.set(namaNorm, tc);
      }
    });

    for (const tl of tokoLokal) {
      const namaBersih = String(tl.nama || "").trim();
      if (!namaBersih) continue;
      const namaNorm = namaBersih.toLowerCase();
      if (!petaNamaToko.has(namaNorm)) {
        const dibuat = await requestSupabase("toko", "POST", [{ nama: namaBersih }]);
        if (dibuat && dibuat[0]) {
          petaNamaToko.set(namaNorm, dibuat[0]);
        }
      }
    }

    const tokoFinalCloud = Array.from(petaNamaToko.values());
    const pemetaanIdLokalKeCloud = {};
    tokoLokal.forEach(tl => {
      const cocok = tokoFinalCloud.find(
        tf => String(tf.nama || "").trim().toLowerCase() === String(tl.nama || "").trim().toLowerCase()
      );
      if (cocok && tl.id !== undefined) {
        pemetaanIdLokalKeCloud[String(tl.id)] = cocok.id;
      }
    });

    const petaBarangCloud = new Map();
    barangCloud.forEach(bc => {
      petaBarangCloud.set(kunciUnikBarang(bc), bc);
    });

    for (const bl of barangLokal) {
      const k = kunciUnikBarang(bl);
      const eksisting = petaBarangCloud.get(k);
      const payload = susunPayloadBarangCloud(bl, pemetaanIdLokalKeCloud);

      if (!eksisting) {
        await requestSupabase("barang", "POST", [payload]);
      } else {
        const waktuLokal = timestampItem(bl);
        const waktuCloud = timestampItem(eksisting);
        if (waktuLokal > waktuCloud && eksisting.id !== undefined) {
          await requestSupabase("barang", "PATCH", payload, `?id=eq.${encodeURIComponent(eksisting.id)}`);
        }
      }
    }

    await muatUlangDariCloudKeLokal();

    if (tampilkanPesan) {
      alert("Sinkronisasi dengan cloud berhasil.");
    }
    return true;
  } catch (err) {
    perbaruiStatusSync("Gagal sync");
    if (tampilkanPesan) {
      alert(`Sinkronisasi cloud belum berhasil: ${err.message}`);
    }
    return false;
  } finally {
    sedangSinkron = false;
  }
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
    const lama = Number(hargaTokoLama[t.id] || 0);
    const baru = Number(hargaTokoBaru[t.id] || 0);
    if (lama !== baru) {
      daftarPerubahan.push(`Harga ${t.nama} dari ${formatRupiah(lama)} menjadi ${formatRupiah(baru)}`);
    }
  });

  if (daftarPerubahan.length === 0) {
    return "Data diperbarui (tidak ada perubahan nilai)";
  }
  return "Mengedit " + daftarPerubahan.join("; ");
}

async function muatToko() {
  if (cloudSudahDiatur() && navigator.onLine) {
    try {
      const tokoCloud = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");
      if (tokoCloud.length > 0) {
        await muatUlangDariCloudKeLokal();
        return;
      }
    } catch (e) {}
  }

  let rows = await db.toko.toArray();
  if (rows.length === 0) {
    for (const nama of TOKO_DEFAULT) {
      await db.toko.add({ nama });
    }
    rows = await db.toko.toArray();
  }
  daftarToko = rows;
  perbaruiStatusSync();
  await tampilkanBarang();
  if (cloudSudahDiatur() && navigator.onLine) {
    sinkronkanSekarang(false);
  }
}

function renderFormToko(nilaiHarga = {}) {
  const container = document.getElementById("input-harga-toko");
  container.innerHTML = "";

  daftarToko.forEach(t => {
    const raw = nilaiHarga[t.id];
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

async function bangunPemetaanTokoLokalKeCloud() {
  const pemetaan = {};
  if (!cloudSudahDiatur() || !navigator.onLine) return pemetaan;
  try {
    const tokoCloud = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");
    daftarToko.forEach(tl => {
      const cocok = tokoCloud.find(
        tc => String(tc.nama || "").trim().toLowerCase() === String(tl.nama || "").trim().toLowerCase()
      );
      if (cocok && tl.id !== undefined) {
        pemetaan[String(tl.id)] = cocok.id;
      }
    });
  } catch (e) {}
  return pemetaan;
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

  const semuaBarang = await db.barang.toArray();
  const duplikat = semuaBarang.find(b => {
    if (idSedangDiedit !== null && b.id === idSedangDiedit) return false;
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
    hargaToko[t.id] = isNaN(angka) ? 0 : angka;
  });

  const waktuSekarang = new Date().toISOString();
  const satuanUkuranSimpan = kategori === "Pupuk" ? satuanPupuk : null;
  let barangTersimpan = null;
  let dataLamaUntukCloud = null;

  if (idSedangDiedit !== null) {
    const idTarget = idSedangDiedit;
    const dataLama = await db.barang.get(idTarget);
    dataLamaUntukCloud = dataLama;
    const dibuatPadaAwal = (dataLama && dataLama.dibuatPada) ? dataLama.dibuatPada : waktuSekarang;
    const riwayatLama = Array.isArray(dataLama && dataLama.riwayatEdit) ? dataLama.riwayatEdit : [];

    barangTersimpan = {
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
          keterangan: susunKeteranganPerubahan(dataLama || {}, {
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

    await db.barang.update(idTarget, barangTersimpan);
    tutupModalBarang();
  } else {
    barangTersimpan = {
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
    await db.barang.add(barangTersimpan);
    tutupModalBarang();
  }

  kategoriAktif = kategori;
  await tampilkanBarang();

  if (cloudSudahDiatur() && navigator.onLine && barangTersimpan) {
    try {
      sedangSinkron = true;
      perbaruiStatusSync("Menyimpan ke cloud...");
      const pemetaanId = await bangunPemetaanTokoLokalKeCloud();
      const payloadBaru = susunPayloadBarangCloud(barangTersimpan, pemetaanId);
      const semuaCloud = await requestSupabase("barang", "GET", null, "?select=*");

      const kunciLama = dataLamaUntukCloud ? kunciUnikBarang(dataLamaUntukCloud) : null;
      const kunciBaru = kunciUnikBarang(barangTersimpan);
      const cocok = semuaCloud.find(
        row => kunciUnikBarang(row) === kunciBaru || (kunciLama && kunciUnikBarang(row) === kunciLama)
      );

      if (cocok && cocok.id !== undefined) {
        await requestSupabase("barang", "PATCH", payloadBaru, `?id=eq.${encodeURIComponent(cocok.id)}`);
      } else {
        await requestSupabase("barang", "POST", [payloadBaru]);
      }

      await muatUlangDariCloudKeLokal();
      if (idDetailAktif !== null) {
        const itemTerbaru = (await db.barang.toArray()).find(b => kunciUnikBarang(b) === kunciBaru);
        if (itemTerbaru) {
          await bukaDetail(itemTerbaru.id);
        }
      }
    } catch (err) {
      perbaruiStatusSync("Gagal sync");
      alert(`Data tersimpan di HP, tetapi gagal ke cloud: ${err.message}`);
    } finally {
      sedangSinkron = false;
    }
  }
}

async function mulaiEdit(id) {
  const item = await db.barang.get(id);
  if (!item) return;

  idSedangDiedit = id;
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
      tdTokoHtml += `<td class="col-toko">${formatAngkaToko(hargaToko[t.id])}</td>`;
    });

    tbody.innerHTML += `
      <tr class="baris-klik" onclick="bukaDetail(${item.id})">
        <td class="col-nama"><strong>${escapeHtml(item.nama)}</strong></td>
        <td class="col-ukuran">${escapeHtml(ukuranTampil)}</td>
        <td class="col-harga"><strong>${formatAngkaToko(item.hargaJual)}</strong></td>
        ${tdTokoHtml}
        <td class="col-aksi" onclick="event.stopPropagation()">
          <button type="button" class="btn-hapus btn-kecil" onclick="hapusBarang(${item.id})">Hapus</button>
        </td>
      </tr>
    `;
  });
}

async function tampilkanBarang() {
  perbaruiModeTabelKategori();
  semuaBarangCache = await db.barang.toArray();
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
  const item = await db.barang.get(id);
  if (!item) return;

  idDetailAktif = id;
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
    tokoBoxesHtml += `
      <div class="detail-box">
        <div class="detail-label">${escapeHtml(t.nama)}</div>
        <div class="detail-val">${formatRupiah(hargaToko[t.id])}</div>
      </div>
    `;
  });
  document.getElementById("detail-harga-toko").innerHTML = tokoBoxesHtml;

  renderLogWaktuDetail(item);

  document.getElementById("detail-btn-hapus").onclick = async () => {
    const terhapus = await hapusBarang(id);
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
  const item = await db.barang.get(id);
  await db.barang.delete(id);
  await tampilkanBarang();

  if (item && cloudSudahDiatur() && navigator.onLine) {
    try {
      sedangSinkron = true;
      perbaruiStatusSync("Menghapus di cloud...");
      const semuaCloud = await requestSupabase("barang", "GET", null, "?select=*");
      const targetKey = kunciUnikBarang(item);
      const cocokList = semuaCloud.filter(row => kunciUnikBarang(row) === targetKey);

      for (const cocok of cocokList) {
        if (cocok && cocok.id !== undefined) {
          await requestSupabase("barang", "DELETE", null, `?id=eq.${encodeURIComponent(cocok.id)}`);
        }
      }

      await muatUlangDariCloudKeLokal();
    } catch (err) {
      perbaruiStatusSync("Gagal sync");
      alert(`Barang terhapus di HP, tetapi gagal dihapus di cloud: ${err.message}`);
    } finally {
      sedangSinkron = false;
    }
  }

  return true;
}

function sinkronkanInputDraftToko() {
  const inputs = document.querySelectorAll(".input-nama-toko");
  inputs.forEach(inp => {
    const id = parseInt(inp.getAttribute("data-id"), 10);
    const target = draftToko.find(t => t.id === id);
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

    draftToko = draftToko.filter(t => !t.isBaru);
    tutupModalTokoLangsung();
    await muatToko();
    return;
  }

  tutupModalTokoLangsung();
}

function renderListEditToko() {
  const listEl = document.getElementById("list-edit-toko");
  listEl.innerHTML = "";

  draftToko.forEach(t => {
    listEl.innerHTML += `
      <div class="toko-row">
        <input type="text" class="input-nama-toko" data-id="${t.id}" value="${escapeHtml(t.nama)}">
        <button type="button" class="btn-hapus btn-kecil" onclick="hapusToko(${t.id})">Hapus</button>
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
  draftToko = draftToko.filter(t => t.id !== id);
  renderListEditToko();
}

async function simpanPerubahanToko() {
  sinkronkanInputDraftToko();

  const tokoTersimpanDiDb = await db.toko.toArray();
  const idDraftAktif = new Set(draftToko.filter(t => t.id > 0).map(t => t.id));
  const tokoTerhapus = tokoTersimpanDiDb.filter(lama => !idDraftAktif.has(lama.id));

  const pemetaanIdLokalKeCloud = await bangunPemetaanTokoLokalKeCloud();

  await db.transaction("rw", db.toko, db.barang, async () => {
    for (const lama of tokoTerhapus) {
      await db.toko.delete(lama.id);
    }

    const semuaBarang = await db.barang.toArray();
    for (const b of semuaBarang) {
      const htBaru = { ...(b.hargaToko || {}) };
      for (const lama of tokoTerhapus) {
        delete htBaru[String(lama.id)];
        delete htBaru[lama.id];
      }
      await db.barang.update(b.id, { hargaToko: htBaru });
    }

    for (const item of draftToko) {
      const namaBersih = (item.nama || "").trim();
      if (!namaBersih) continue;

      if (item.id > 0) {
        await db.toko.update(item.id, { nama: namaBersih });
      } else {
        await db.toko.add({ nama: namaBersih });
      }
    }
  });

  tutupModalTokoLangsung();
  daftarToko = await db.toko.toArray();
  await tampilkanBarang();

  if (cloudSudahDiatur() && navigator.onLine) {
    try {
      sedangSinkron = true;
      perbaruiStatusSync("Menyimpan toko ke cloud...");
      const tokoCloud = await requestSupabase("toko", "GET", null, "?select=*&order=id.asc");

      // Hapus toko di cloud yang dihapus di draft
      const idCloudDihapus = new Set();
      for (const lama of tokoTerhapus) {
        const cocokCloud = tokoCloud.find(
          tc => String(tc.nama || "").trim().toLowerCase() === String(lama.nama || "").trim().toLowerCase()
        );
        if (cocokCloud && cocokCloud.id !== undefined) {
          idCloudDihapus.add(String(cocokCloud.id));
          await requestSupabase("toko", "DELETE", null, `?id=eq.${encodeURIComponent(cocokCloud.id)}`);
        }
      }

      // Perbarui nama toko atau tambah toko baru di cloud
      for (const item of draftToko) {
        const namaBersih = (item.nama || "").trim();
        if (!namaBersih) continue;

        if (item.id > 0) {
          const idCloud = pemetaanIdLokalKeCloud[String(item.id)];
          if (idCloud !== undefined) {
            await requestSupabase("toko", "PATCH", { nama: namaBersih }, `?id=eq.${encodeURIComponent(idCloud)}`);
          } else {
            const cocokNama = tokoCloud.find(
              tc => String(tc.nama || "").trim().toLowerCase() === namaBersih.toLowerCase()
            );
            if (cocokNama && cocokNama.id !== undefined) {
              await requestSupabase("toko", "PATCH", { nama: namaBersih }, `?id=eq.${encodeURIComponent(cocokNama.id)}`);
            } else {
              await requestSupabase("toko", "POST", [{ nama: namaBersih }]);
            }
          }
        } else {
          const sudahAda = tokoCloud.find(
            tc => String(tc.nama || "").trim().toLowerCase() === namaBersih.toLowerCase()
          );
          if (!sudahAda) {
            await requestSupabase("toko", "POST", [{ nama: namaBersih }]);
          }
        }
      }

      // Bersihkan key toko yang dihapus dari harga_toko pada semua barang di cloud
      if (idCloudDihapus.size > 0) {
        const barangCloud = await requestSupabase("barang", "GET", null, "?select=*");
        for (const bc of barangCloud) {
          const rawHt = bc.harga_toko || bc.hargaToko || {};
          let berubah = false;
          const htBersih = {};
          Object.keys(rawHt).forEach(k => {
            if (idCloudDihapus.has(String(k))) {
              berubah = true;
            } else {
              htBersih[k] = rawHt[k];
            }
          });
          if (berubah && bc.id !== undefined) {
            await requestSupabase("barang", "PATCH", { harga_toko: htBersih }, `?id=eq.${encodeURIComponent(bc.id)}`);
          }
        }
      }

      await muatUlangDariCloudKeLokal();
    } catch (err) {
      perbaruiStatusSync("Gagal sync");
      alert(`Toko tersimpan di HP, tetapi gagal disinkronkan ke cloud: ${err.message}`);
    } finally {
      sedangSinkron = false;
    }
  }
}

window.addEventListener("online", () => {
  perbaruiStatusSync("Online");
  if (cloudSudahDiatur()) {
    sinkronkanSekarang(false);
  }
});

window.addEventListener("offline", () => {
  perbaruiStatusSync("Offline");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

muatToko();
