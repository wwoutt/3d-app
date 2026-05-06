import { useEffect, useMemo, useRef, useState } from "react";
import Dexie from "dexie";
import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import packageJson from "../package.json";

const APP_VERSION = packageJson.version;

const buttonBaseStyle = {
  margin: 6,
  padding: "8px 12px",
  borderRadius: 8,
  background: "#2563eb",
  color: "white",
  border: "none",
  cursor: "pointer",
};

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #4b5563",
  background: "#111827",
  color: "white",
  boxSizing: "border-box",
};

const selectStyle = {
  ...inputStyle,
  marginBottom: 10,
};

const panelStyle = {
  border: "1px solid #374151",
  padding: 16,
  marginBottom: 16,
  borderRadius: 12,
  background: "#1f2937",
};

const dataFilePickerOptions = {
  id: "3d-print-manager-data",
  suggestedName: "3d-print-manager-data.json",
  types: [
    {
      description: "3D Print Manager data",
      accept: {
        "application/json": [".json"],
      },
    },
  ],
};

const getFilePickerOptions = (startIn) => ({
  ...dataFilePickerOptions,
  ...(startIn ? { startIn } : {}),
});

const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_FILES = 20;

// ---------- UI ----------
const Btn = ({ children, style, ...props }) => (
  <button {...props} style={{ ...buttonBaseStyle, ...style }}>
    {children}
  </button>
);

const In = ({ label, ...props }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ display: "block", marginBottom: 6 }}>{label}</label>
    <input {...props} style={inputStyle} />
  </div>
);

const Box = ({ children }) => <div style={panelStyle}>{children}</div>;

// ---------- DB ----------
const db = new Dexie("3DPrintDB");
db.version(6).stores({
  materials: "++id,name",
  colors: "++id,materialId,name,stock",
  purchases: "++id,colorId,grams,price,date",
  products: "++id,name,grams,printTime,workTime,link,image",
  prints: "++id,productId,colorId,amount,sellingPrice,date",
  settings: "id",
});

db.version(7).stores({
  materials: "++id,name",
  colors: "++id,materialId,name,stock",
  purchases: "++id,colorId,grams,price,date",
  parts: "++id,name,category,stock",
  partPurchases: "++id,partId,amount,price,date",
  products: "++id,name,grams,printTime,workTime,link,image",
  prints: "++id,productId,colorId,amount,sellingPrice,date",
  settings: "id",
});

db.version(8).stores({
  materials: "++id,name",
  colors: "++id,materialId,name,stock",
  purchases: "++id,colorId,grams,price,date",
  parts: "++id,name,category,stock",
  partPurchases: "++id,partId,amount,price,date",
  products: "++id,name,grams,printTime,workTime,link,image",
  prints: "++id,productId,colorId,amount,sellingPrice,date",
  settings: "id",
  appMeta: "key",
});

db.version(9).stores({
  materials: "++id,name",
  colors: "++id,materialId,name,stock",
  purchases: "++id,colorId,grams,price,date",
  parts: "++id,name,category,stock",
  partPurchases: "++id,partId,amount,price,date",
  products: "++id,name,printTime,workTime,link,image",
  prints: "++id,productId,printerId,amount,sellingPrice,date",
  settings: "id",
  appMeta: "key",
});

// ---------- HELPERS ----------
const avgPricePerKg = (purchases, colorId) => {
  const list = purchases.filter((purchase) => purchase.colorId == colorId);
  const grams = list.reduce((sum, purchase) => sum + Number(purchase.grams || 0), 0);
  const total = list.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  return grams ? (total / grams) * 1000 : 0;
};

const getComponentCostPerUnit = (product) =>
  (product.components || []).reduce((sum, component) => sum + Number(component.cost || 0), 0);

const normalizeFilamentUses = (filamentUses) =>
  (filamentUses || [])
    .filter((use) => use.colorId && Number(use.grams || 0) > 0)
    .map((use) => ({
      colorId: Number(use.colorId),
      grams: Number(use.grams),
    }));

const getFilamentUsesForRecord = (record, product) => {
  const normalized = normalizeFilamentUses(record?.filamentUses);
  if (normalized.length > 0) {
    return normalized;
  }

  if (record?.colorId && Number(record?.grams ?? product?.grams ?? 0) > 0) {
    return [
      {
        colorId: Number(record.colorId),
        grams: Number(record.grams ?? product?.grams ?? 0),
      },
    ];
  }

  return [];
};

const calcFilamentBreakdown = (filamentUses, amount, purchases, settings) => {
  const normalizedUses = normalizeFilamentUses(filamentUses);
  const wasteFactor = 1 + (settings.waste || 0) / 100;

  const entries = normalizedUses.map((use) => {
    const gramsPerPrint = Number(use.grams || 0);
    const gramsTotal = gramsPerPrint * amount * wasteFactor;
    const pricePerKg = avgPricePerKg(purchases, use.colorId);
    const cost = (gramsTotal / 1000) * pricePerKg;

    return {
      colorId: use.colorId,
      gramsPerPrint,
      gramsTotal,
      pricePerKg,
      cost,
    };
  });

  return {
    entries,
    totalGrams: entries.reduce((sum, entry) => sum + entry.gramsTotal, 0),
    totalCost: entries.reduce((sum, entry) => sum + entry.cost, 0),
  };
};

const calcCostBreakdown = (product, amount, filamentUses, purchases, settings, printerId) => {
  const filamentBreakdown = calcFilamentBreakdown(filamentUses, amount, purchases, settings);
  const filament = filamentBreakdown.totalCost;
  const printer =
    (settings.printers || []).find((entry) => entry.id == printerId) ||
    settings.printers?.[0] || {
      name: "Default printer",
      powerLow: settings.powerLow,
      powerMid: settings.powerMid,
      powerHigh: settings.powerHigh,
    };
  const power =
    product.printTime < 2
      ? printer.powerLow
      : product.printTime < 6
        ? printer.powerMid
        : printer.powerHigh;
  const electricity = (power / 1000) * (Number(product.printTime || 0) * amount) * settings.electricityPrice;
  const labor = Number(product.workTime || 0) * amount * settings.hourlyRate;
  const parts = getComponentCostPerUnit(product) * amount;
  const perOrderOverhead = (settings.overheads || [])
    .filter((entry) => entry.mode === "perOrder")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const perPrintDepreciation = (settings.depreciations || [])
    .filter((entry) => entry.mode === "perPrint")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const perHourDepreciation = (settings.depreciations || [])
    .filter((entry) => entry.mode === "perHour")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const overhead = perOrderOverhead * amount;
  const depreciation = perPrintDepreciation * amount + perHourDepreciation * Number(product.printTime || 0) * amount;
  return {
    filament,
    parts,
    electricity,
    labor,
    overhead,
    depreciation,
    printerName: printer?.name || "",
    filamentEntries: filamentBreakdown.entries,
    filamentGrams: filamentBreakdown.totalGrams,
    total: filament + parts + electricity + labor + overhead + depreciation,
  };
};

const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
};

const startOfWeek = () => {
  const value = startOfToday();
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return value;
};

const startOfMonth = () => {
  const value = startOfToday();
  value.setDate(1);
  return value;
};

const startOfYear = () => {
  const value = startOfToday();
  value.setMonth(0, 1);
  return value;
};

const endOfToday = () => {
  const value = new Date();
  value.setHours(23, 59, 59, 999);
  return value;
};

const getDateRangeForPreset = (preset, customFrom, customTo) => {
  if (preset === "custom") {
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
      to: customTo ? new Date(`${customTo}T23:59:59.999`) : null,
    };
  }

  if (preset === "today") {
    return { from: startOfToday(), to: endOfToday() };
  }

  if (preset === "week") {
    return { from: startOfWeek(), to: endOfToday() };
  }

  if (preset === "month") {
    return { from: startOfMonth(), to: endOfToday() };
  }

  if (preset === "year") {
    return { from: startOfYear(), to: endOfToday() };
  }

  return { from: null, to: null };
};

const isWithinDateRange = (value, from, to) => {
  const dateValue = new Date(value);
  if (from && dateValue < from) {
    return false;
  }
  if (to && dateValue > to) {
    return false;
  }
  return true;
};

const normalizeSettings = (storedSettings) => {
  const basePrinters =
    Array.isArray(storedSettings?.printers) && storedSettings.printers.length > 0
      ? storedSettings.printers.map((printer) => ({
          id: printer.id || crypto.randomUUID(),
          name: printer.name || "Unnamed printer",
          powerLow: Number(printer.powerLow ?? storedSettings.powerLow ?? 150),
          powerMid: Number(printer.powerMid ?? storedSettings.powerMid ?? 180),
          powerHigh: Number(printer.powerHigh ?? storedSettings.powerHigh ?? 220),
        }))
      : [
          {
            id: "default-printer",
            name: "Default printer",
            powerLow: Number(storedSettings?.powerLow ?? 150),
            powerMid: Number(storedSettings?.powerMid ?? 180),
            powerHigh: Number(storedSettings?.powerHigh ?? 220),
          },
        ];

  return {
    electricityPrice: Number(storedSettings?.electricityPrice ?? 0.3),
    hourlyRate: Number(storedSettings?.hourlyRate ?? 15),
    powerLow: Number(storedSettings?.powerLow ?? basePrinters[0].powerLow ?? 150),
    powerMid: Number(storedSettings?.powerMid ?? basePrinters[0].powerMid ?? 180),
    powerHigh: Number(storedSettings?.powerHigh ?? basePrinters[0].powerHigh ?? 220),
    margin: Number(storedSettings?.margin ?? 30),
    waste: Number(storedSettings?.waste ?? 5),
    printers: basePrinters,
    overheads: Array.isArray(storedSettings?.overheads)
      ? storedSettings.overheads.map((entry) => ({
          id: entry.id || crypto.randomUUID(),
          name: entry.name || "Unnamed overhead",
          amount: Number(entry.amount || 0),
          mode: entry.mode === "perOrder" ? "perOrder" : "monthly",
        }))
      : [],
    depreciations: Array.isArray(storedSettings?.depreciations)
      ? storedSettings.depreciations.map((entry) => ({
          id: entry.id || crypto.randomUUID(),
          name: entry.name || "Unnamed depreciation",
          amount: Number(entry.amount || 0),
          mode: entry.mode === "perHour" ? "perHour" : "perPrint",
        }))
      : [],
  };
};

export default function App() {
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("materials");

  const [materials, setMaterials] = useState([]);
  const [colors, setColors] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [parts, setParts] = useState([]);
  const [partPurchases, setPartPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [prints, setPrints] = useState([]);

  const [settings, setSettings] = useState({
    electricityPrice: 0.3,
    hourlyRate: 15,
    powerLow: 150,
    powerMid: 180,
    powerHigh: 220,
    margin: 30,
    waste: 5,
    printers: [
      {
        id: "default-printer",
        name: "Default printer",
        powerLow: 150,
        powerMid: 180,
        powerHigh: 220,
      },
    ],
    overheads: [],
    depreciations: [],
  });

  const [mName, setMName] = useState("");
  const [cForm, setCForm] = useState({ name: "", materialId: "" });
  const [buy, setBuy] = useState({ colorId: "", grams: 0, price: 0, notes: "" });
  const [partForm, setPartForm] = useState({ name: "", category: "" });
  const [partBuy, setPartBuy] = useState({ partId: "", amount: 1, price: 0, notes: "" });
  const [prod, setProd] = useState({ name: "", printTime: 0, workTime: 0, link: "", image: "", notes: "", components: [] });
  const [editProduct, setEditProduct] = useState(null);
  const [run, setRun] = useState({ productId: "", printerId: "default-printer", amount: 1, sellingPrice: 0, notes: "", filamentUses: [] });
  const [componentForm, setComponentForm] = useState({ name: "", cost: 0 });
  const [filamentForm, setFilamentForm] = useState({ colorId: "", grams: 0 });
  const [dataFileHandle, setDataFileHandle] = useState(null);
  const [dataFileName, setDataFileName] = useState("");
  const [fileStorageReady, setFileStorageReady] = useState(false);
  const [backupDirectoryHandle, setBackupDirectoryHandle] = useState(null);
  const [backupDirectoryName, setBackupDirectoryName] = useState("");
  const [printerForm, setPrinterForm] = useState({ name: "", powerLow: 150, powerMid: 180, powerHigh: 220 });
  const [overheadForm, setOverheadForm] = useState({ name: "", amount: 0, mode: "monthly" });
  const [depreciationForm, setDepreciationForm] = useState({ name: "", amount: 0, mode: "perPrint" });
  const [searchMaterials, setSearchMaterials] = useState("");
  const [searchParts, setSearchParts] = useState("");
  const [searchProducts, setSearchProducts] = useState("");
  const [overviewPeriod, setOverviewPeriod] = useState("month");
  const [overviewFrom, setOverviewFrom] = useState("");
  const [overviewTo, setOverviewTo] = useState("");
  const [timelineTypeFilter, setTimelineTypeFilter] = useState("all");
  const [timelineProductFilter, setTimelineProductFilter] = useState("");
  const [timelineMaterialFilter, setTimelineMaterialFilter] = useState("");
  const [timelineMonthFilter, setTimelineMonthFilter] = useState("");

  const initializedRef = useRef(false);
  const autosaveInFlightRef = useRef(false);
  const autosaveQueuedRef = useRef(false);
  const lastSnapshotAtRef = useRef(0);

  const supportsFileStorage =
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function";
  const supportsDirectoryStorage =
    typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

  const showToast = (message, success = true) => {
    setToast({ message, success });
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(null), 2000);
  };

  const collectDataSnapshot = async () => ({
    schemaVersion: 1,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
    materials: await db.materials.toArray(),
    colors: await db.colors.toArray(),
    purchases: await db.purchases.toArray(),
    parts: await db.parts.toArray(),
    partPurchases: await db.partPurchases.toArray(),
    products: await db.products.toArray(),
    prints: await db.prints.toArray(),
    settings: [{ ...settings, id: 1 }],
  });

  async function replaceDataFromSnapshot(snapshot) {
    const safeSnapshot = {
      materials: Array.isArray(snapshot.materials) ? snapshot.materials : [],
      colors: Array.isArray(snapshot.colors) ? snapshot.colors : [],
      purchases: Array.isArray(snapshot.purchases) ? snapshot.purchases : [],
      parts: Array.isArray(snapshot.parts) ? snapshot.parts : [],
      partPurchases: Array.isArray(snapshot.partPurchases) ? snapshot.partPurchases : [],
      products: Array.isArray(snapshot.products) ? snapshot.products : [],
      prints: Array.isArray(snapshot.prints) ? snapshot.prints : [],
      settings: Array.isArray(snapshot.settings) ? snapshot.settings : [],
    };

    await db.transaction(
      "rw",
      db.materials,
      db.colors,
      db.purchases,
      db.parts,
      db.partPurchases,
      db.products,
      db.prints,
      db.settings,
      async () => {
        await db.materials.clear();
        await db.colors.clear();
        await db.purchases.clear();
        await db.parts.clear();
        await db.partPurchases.clear();
        await db.products.clear();
        await db.prints.clear();
        await db.settings.clear();

        if (safeSnapshot.materials.length) await db.materials.bulkPut(safeSnapshot.materials);
        if (safeSnapshot.colors.length) await db.colors.bulkPut(safeSnapshot.colors);
        if (safeSnapshot.purchases.length) await db.purchases.bulkPut(safeSnapshot.purchases);
        if (safeSnapshot.parts.length) await db.parts.bulkPut(safeSnapshot.parts);
        if (safeSnapshot.partPurchases.length) await db.partPurchases.bulkPut(safeSnapshot.partPurchases);
        if (safeSnapshot.products.length) await db.products.bulkPut(safeSnapshot.products);
        if (safeSnapshot.prints.length) await db.prints.bulkPut(safeSnapshot.prints);
        if (safeSnapshot.settings.length) await db.settings.bulkPut(safeSnapshot.settings);
      },
    );
  }

  async function storeDataFileHandle(handle) {
    await db.appMeta.put({ key: "dataFileHandle", value: handle });
    setDataFileHandle(handle);
    setDataFileName(handle?.name || "");
    setFileStorageReady(Boolean(handle));
  }

  async function clearStoredDataFileHandle() {
    if (db.appMeta) {
      await db.appMeta.delete("dataFileHandle");
    }
    setDataFileHandle(null);
    setDataFileName("");
    setFileStorageReady(false);
  }

  async function storeBackupDirectoryHandle(handle) {
    await db.appMeta.put({ key: "backupDirectoryHandle", value: handle });
    setBackupDirectoryHandle(handle);
    setBackupDirectoryName(handle?.name || "");
  }

  async function clearStoredBackupDirectoryHandle() {
    if (db.appMeta) {
      await db.appMeta.delete("backupDirectoryHandle");
    }
    setBackupDirectoryHandle(null);
    setBackupDirectoryName("");
  }

  async function ensureFilePermission(handle) {
    if (!handle) {
      return false;
    }

    const permissionOptions = { mode: "readwrite" };

    if ((await handle.queryPermission(permissionOptions)) === "granted") {
      return true;
    }

    return (await handle.requestPermission(permissionOptions)) === "granted";
  }

  async function ensureDirectoryPermission(handle) {
    if (!handle) {
      return false;
    }

    const permissionOptions = { mode: "readwrite" };

    if ((await handle.queryPermission(permissionOptions)) === "granted") {
      return true;
    }

    return (await handle.requestPermission(permissionOptions)) === "granted";
  }

  async function writeSnapshotToFile(handle, snapshot) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(snapshot, null, 2));
    await writable.close();
  }

  function buildSnapshotFileName() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `3d-print-manager-snapshot-${timestamp}.json`;
  }

  async function pruneOldSnapshots(directoryHandle) {
    const snapshotEntries = [];

    for await (const entry of directoryHandle.values()) {
      if (entry.kind === "file" && entry.name.startsWith("3d-print-manager-snapshot-") && entry.name.endsWith(".json")) {
        snapshotEntries.push(entry.name);
      }
    }

    snapshotEntries.sort();

    while (snapshotEntries.length > MAX_SNAPSHOT_FILES) {
      const oldest = snapshotEntries.shift();
      if (oldest) {
        await directoryHandle.removeEntry(oldest);
      }
    }
  }

  async function saveSnapshotToDirectory(showSuccessToast = false) {
    if (!backupDirectoryHandle) {
      return false;
    }

    if (!(await ensureDirectoryPermission(backupDirectoryHandle))) {
      showToast("Geen schrijfrechten voor snapshotmap", false);
      return false;
    }

    const snapshot = await collectDataSnapshot();
    const fileHandle = await backupDirectoryHandle.getFileHandle(buildSnapshotFileName(), { create: true });
    await writeSnapshotToFile(fileHandle, snapshot);
    await pruneOldSnapshots(backupDirectoryHandle);
    lastSnapshotAtRef.current = Date.now();

    if (showSuccessToast) {
      showToast("Snapshot opgeslagen");
    }

    return true;
  }

  async function saveBoundFileNow(showSuccessToast = false) {
    if (!dataFileHandle) {
      return false;
    }

    if (!(await ensureFilePermission(dataFileHandle))) {
      setFileStorageReady(false);
      showToast("Geen schrijfrechten voor databestand", false);
      return false;
    }

    const snapshot = await collectDataSnapshot();
    await writeSnapshotToFile(dataFileHandle, snapshot);
    setFileStorageReady(true);

    if (showSuccessToast) {
      showToast("Databestand opgeslagen");
    }

    return true;
  }

  async function flushAutosaveQueue() {
    if (!dataFileHandle || autosaveInFlightRef.current) {
      return;
    }

    autosaveInFlightRef.current = true;

    try {
      await saveBoundFileNow(false);
      if (backupDirectoryHandle && Date.now() - lastSnapshotAtRef.current >= AUTO_SNAPSHOT_INTERVAL_MS) {
        await saveSnapshotToDirectory(false);
      }
    } catch {
      showToast("Automatisch opslaan mislukt", false);
    } finally {
      autosaveInFlightRef.current = false;
      if (autosaveQueuedRef.current) {
        autosaveQueuedRef.current = false;
        void flushAutosaveQueue();
      }
    }
  }

  async function attachFileHandle(handle, loadFromFile) {
    if (!(await ensureFilePermission(handle))) {
      showToast("Toegang tot databestand geweigerd", false);
      return false;
    }

    if (loadFromFile) {
      const file = await handle.getFile();
      const text = await file.text();
      if (text.trim()) {
        const snapshot = JSON.parse(text);
        await replaceDataFromSnapshot(snapshot);
      }
    } else {
      const snapshot = await collectDataSnapshot();
      await writeSnapshotToFile(handle, snapshot);
    }

    await storeDataFileHandle(handle);
    await mergeDuplicateMaterials();
    await loadSettings();
    await loadAll();
    initializedRef.current = true;
    return true;
  }

  useEffect(() => {
    async function init() {
      if (supportsFileStorage && db.appMeta) {
        const storedHandle = await db.appMeta.get("dataFileHandle");
        if (storedHandle?.value) {
          try {
            await attachFileHandle(storedHandle.value, true);
          } catch {
            await clearStoredDataFileHandle();
            showToast("Kon eerder databestand niet automatisch openen", false);
          }
        }
      }

      if (supportsDirectoryStorage && db.appMeta) {
        const storedDirectory = await db.appMeta.get("backupDirectoryHandle");
        if (storedDirectory?.value) {
          try {
            await storeBackupDirectoryHandle(storedDirectory.value);
          } catch {
            await clearStoredBackupDirectoryHandle();
          }
        }
      }

      await mergeDuplicateMaterials();
      await loadSettings();
      await loadAll();
      initializedRef.current = true;
    }

    init();
    // This effect boots the app once and restores a previously linked data file when possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initializedRef.current || !dataFileHandle) {
      return;
    }

    autosaveQueuedRef.current = true;
    void flushAutosaveQueue();
    // Autosave is intentionally driven by the latest loaded state plus the active file binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials, colors, purchases, parts, partPurchases, products, prints, settings, dataFileHandle]);

  useEffect(() => {
    if (!settings.printers?.length) {
      return;
    }

    if (!settings.printers.some((printer) => printer.id === run.printerId)) {
      setRun((current) => ({ ...current, printerId: settings.printers[0].id }));
    }
  }, [run.printerId, settings.printers]);

  async function loadAll() {
    setMaterials(await db.materials.toArray());
    setColors(await db.colors.toArray());
    setPurchases(await db.purchases.toArray());
    setParts(await db.parts.toArray());
    setPartPurchases(await db.partPurchases.toArray());
    setProducts(await db.products.toArray());
    setPrints(await db.prints.toArray());
  }

  async function mergeDuplicateMaterials() {
    const allMaterials = await db.materials.toArray();
    const materialMap = {};

    for (const material of allMaterials) {
      const key = material.name.toLowerCase();

      if (!materialMap[key]) {
        materialMap[key] = material;
        continue;
      }

      const primary = materialMap[key];
      const linkedColors = await db.colors.where("materialId").equals(material.id).toArray();

      for (const color of linkedColors) {
        await db.colors.update(color.id, { materialId: primary.id });
      }

      await db.materials.delete(material.id);
    }
  }

  async function loadSettings() {
    const stored = await db.settings.get(1);
    if (stored) {
      setSettings(normalizeSettings(stored));
    }
  }

  async function saveSettings() {
    await db.settings.put({ ...normalizeSettings(settings), id: 1 });
    showToast("Instellingen opgeslagen");
  }

  // ---------- BACKUP ----------
  const exportData = async () => {
    const data = await collectDataSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "backup.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup geexporteerd");
  };

  const importData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await replaceDataFromSnapshot(data);

      await loadSettings();
      await loadAll();
      showToast("Backup geimporteerd");
    } catch {
      showToast("Import mislukt", false);
    } finally {
      event.target.value = "";
    }
  };

  const createLocalDataFile = async () => {
    if (!supportsFileStorage) {
      showToast("Bestandsopslag wordt niet ondersteund in deze browser", false);
      return;
    }

    try {
      const handle = await window.showSaveFilePicker(dataFilePickerOptions);
      const connected = await attachFileHandle(handle, false);
      if (connected) {
        showToast("Nieuw lokaal databestand gekoppeld");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast("Aanmaken van databestand mislukt", false);
      }
    }
  };

  const openExistingDataFile = async () => {
    if (!supportsFileStorage) {
      showToast("Bestandsopslag wordt niet ondersteund in deze browser", false);
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker(getFilePickerOptions(dataFileHandle || "documents"));
      if (!handle) {
        return;
      }

      const connected = await attachFileHandle(handle, true);
      if (connected) {
        showToast("Bestaand databestand geladen");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast("Openen van databestand mislukt", false);
      }
    }
  };

  const reopenCurrentDataFile = async () => {
    if (!supportsFileStorage) {
      showToast("Bestandsopslag wordt niet ondersteund in deze browser", false);
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker(getFilePickerOptions(dataFileHandle || "documents"));
      if (!handle) {
        return;
      }

      const connected = await attachFileHandle(handle, true);
      if (connected) {
        showToast("Databestand opnieuw geopend");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast("Opnieuw openen van databestand mislukt", false);
      }
    }
  };

  const disconnectDataFile = async () => {
    await clearStoredDataFileHandle();
    showToast("Bestandskoppeling losgekoppeld");
  };

  const chooseBackupDirectory = async () => {
    if (!supportsDirectoryStorage) {
      showToast("Snapshotmap wordt niet ondersteund in deze browser", false);
      return;
    }

    try {
      const handle = await window.showDirectoryPicker();
      if (!(await ensureDirectoryPermission(handle))) {
        showToast("Toegang tot snapshotmap geweigerd", false);
        return;
      }

      await storeBackupDirectoryHandle(handle);
      showToast("Snapshotmap gekoppeld");
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast("Kiezen van snapshotmap mislukt", false);
      }
    }
  };

  const disconnectBackupDirectory = async () => {
    await clearStoredBackupDirectoryHandle();
    showToast("Snapshotmap losgekoppeld");
  };

  const addPrinterProfile = () => {
    const name = printerForm.name.trim();
    if (!name) {
      showToast("Geef de printer een naam", false);
      return;
    }

    setSettings((current) => ({
      ...current,
      printers: [
        ...(current.printers || []),
        {
          id: crypto.randomUUID(),
          name,
          powerLow: Number(printerForm.powerLow),
          powerMid: Number(printerForm.powerMid),
          powerHigh: Number(printerForm.powerHigh),
        },
      ],
    }));
    setPrinterForm({ name: "", powerLow: 150, powerMid: 180, powerHigh: 220 });
  };

  const removePrinterProfile = (printerId) => {
    setSettings((current) => {
      const nextPrinters = (current.printers || []).filter((printer) => printer.id !== printerId);
      if (nextPrinters.length === 0) {
        showToast("Minstens één printerprofiel is nodig", false);
        return current;
      }
      return { ...current, printers: nextPrinters };
    });
  };

  const addOverhead = () => {
    const name = overheadForm.name.trim();
    if (!name) {
      showToast("Geef de overhead een naam", false);
      return;
    }

    setSettings((current) => ({
      ...current,
      overheads: [
        ...(current.overheads || []),
        {
          id: crypto.randomUUID(),
          name,
          amount: Number(overheadForm.amount),
          mode: overheadForm.mode,
        },
      ],
    }));
    setOverheadForm({ name: "", amount: 0, mode: "monthly" });
  };

  const removeOverhead = (overheadId) => {
    setSettings((current) => ({
      ...current,
      overheads: (current.overheads || []).filter((entry) => entry.id !== overheadId),
    }));
  };

  const addDepreciation = () => {
    const name = depreciationForm.name.trim();
    if (!name) {
      showToast("Geef de afschrijving een naam", false);
      return;
    }

    setSettings((current) => ({
      ...current,
      depreciations: [
        ...(current.depreciations || []),
        {
          id: crypto.randomUUID(),
          name,
          amount: Number(depreciationForm.amount),
          mode: depreciationForm.mode,
        },
      ],
    }));
    setDepreciationForm({ name: "", amount: 0, mode: "perPrint" });
  };

  const removeDepreciation = (depreciationId) => {
    setSettings((current) => ({
      ...current,
      depreciations: (current.depreciations || []).filter((entry) => entry.id !== depreciationId),
    }));
  };

  // ---------- CRUD ----------
  const addMaterial = async () => {
    const name = mName.trim();
    if (!name) {
      showToast("Vul een materiaalnaam in", false);
      return;
    }

    const exists = materials.find((material) => material.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast("Materiaal bestaat al", false);
      return;
    }

    await db.materials.add({ name });
    setMName("");
    await loadAll();
    showToast("Materiaal toegevoegd");
  };

  const deleteMaterial = async (id) => {
    await db.materials.delete(id);

    const relatedColors = colors.filter((color) => color.materialId == id);
    for (const color of relatedColors) {
      await db.colors.delete(color.id);
    }

    await loadAll();
    showToast("Materiaal verwijderd");
  };

  const deleteColor = async (id) => {
    await db.colors.delete(id);
    await loadAll();
    showToast("Kleur verwijderd");
  };

  const addColor = async () => {
    if (!cForm.materialId || !cForm.name.trim()) {
      showToast("Kies een materiaal en kleur", false);
      return;
    }

    const material = materials.find((entry) => entry.id == cForm.materialId);
    const fullName = material ? `${material.name} - ${cForm.name.trim()}` : cForm.name.trim();

    await db.colors.add({
      materialId: Number(cForm.materialId),
      name: fullName,
      stock: 0,
    });

    setCForm({ name: "", materialId: "" });
    await loadAll();
    showToast("Kleur toegevoegd");
  };

  const addPurchase = async () => {
    if (!buy.colorId || !buy.grams || !buy.price) {
      showToast("Vul kleur, gram en prijs in", false);
      return;
    }

    await db.purchases.add({
      ...buy,
      colorId: Number(buy.colorId),
      grams: Number(buy.grams),
      price: Number(buy.price),
      notes: buy.notes.trim(),
      date: new Date(),
    });

    const color = colors.find((entry) => entry.id == buy.colorId);
    if (color) {
      await db.colors.update(color.id, { stock: Number(color.stock || 0) + Number(buy.grams) });
    }

    setBuy({ colorId: "", grams: 0, price: 0, notes: "" });
    await loadAll();
    showToast("Inkoop toegevoegd");
  };

  const addPart = async () => {
    const name = partForm.name.trim();
    if (!name) {
      showToast("Vul een onderdeelnaam in", false);
      return;
    }

    const exists = parts.find((part) => part.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      showToast("Onderdeel bestaat al", false);
      return;
    }

    await db.parts.add({
      name,
      category: partForm.category.trim(),
      stock: 0,
    });
    setPartForm({ name: "", category: "" });
    await loadAll();
    showToast("Onderdeel toegevoegd");
  };

  const deletePart = async (id) => {
    await db.parts.delete(id);
    const relatedPurchases = partPurchases.filter((purchase) => purchase.partId == id);
    for (const purchase of relatedPurchases) {
      await db.partPurchases.delete(purchase.id);
    }
    await loadAll();
    showToast("Onderdeel verwijderd");
  };

  const addPartPurchase = async () => {
    if (!partBuy.partId || !partBuy.amount || !partBuy.price) {
      showToast("Vul onderdeel, aantal en prijs in", false);
      return;
    }

    await db.partPurchases.add({
      partId: Number(partBuy.partId),
      amount: Number(partBuy.amount),
      price: Number(partBuy.price),
      notes: partBuy.notes.trim(),
      date: new Date(),
    });

    const part = parts.find((entry) => entry.id == partBuy.partId);
    if (part) {
      await db.parts.update(part.id, { stock: Number(part.stock || 0) + Number(partBuy.amount) });
    }

    setPartBuy({ partId: "", amount: 1, price: 0, notes: "" });
    await loadAll();
    showToast("Onderdeleninkoop toegevoegd");
  };

  const updatePartStock = async (id, value) => {
    await db.parts.update(id, { stock: Number(value) });
    await loadAll();
    showToast("Onderdelenvoorraad aangepast");
  };

  const saveProduct = async () => {
    if (!prod.name.trim()) {
      showToast("Geef het product een naam", false);
      return;
    }

    const payload = {
      ...prod,
      name: prod.name.trim(),
      printTime: Number(prod.printTime),
      workTime: Number(prod.workTime),
      link: prod.link.trim(),
      image: prod.image.trim(),
      notes: prod.notes.trim(),
      components: (prod.components || [])
        .filter((component) => component.name?.trim())
        .map((component) => ({
          id: component.id || crypto.randomUUID(),
          name: component.name.trim(),
          cost: Number(component.cost || 0),
        })),
    };

    if (editProduct) {
      await db.products.update(editProduct.id, payload);
      setEditProduct(null);
      showToast("Product bijgewerkt");
    } else {
      await db.products.add(payload);
      showToast("Product toegevoegd");
    }

    setProd({ name: "", printTime: 0, workTime: 0, link: "", image: "", notes: "", components: [] });
    setComponentForm({ name: "", cost: 0 });
    await loadAll();
  };

  const startEdit = (product) => {
    setEditProduct(product);
    setProd({
      ...product,
      grams: undefined,
      notes: product.notes || "",
      components: (product.components || []).map((component) => ({
        id: component.id || crypto.randomUUID(),
        name: component.name || "",
        cost: Number(component.cost || 0),
      })),
    });
    setComponentForm({ name: "", cost: 0 });
    setTab("products");
  };

  const deleteProduct = async (id) => {
    await db.products.delete(id);
    await loadAll();
    showToast("Product verwijderd");
  };

  const addPrint = async () => {
    const filamentUses = normalizeFilamentUses(run.filamentUses);

    if (!run.productId || !run.printerId || !run.amount || filamentUses.length === 0) {
      showToast("Kies product, printer, aantal en filamentgebruik", false);
      return;
    }

    const product = products.find((entry) => entry.id == run.productId);

    await db.prints.add({
      ...run,
      productId: Number(run.productId),
      printerId: run.printerId,
      amount: Number(run.amount),
      sellingPrice: Number(run.sellingPrice),
      notes: run.notes.trim(),
      filamentUses,
      date: new Date(),
    });

    if (product) {
      const wasteFactor = 1 + (settings.waste || 0) / 100;
      for (const use of filamentUses) {
        const color = colors.find((entry) => entry.id == use.colorId);
        if (color) {
          const usedGrams = Number(use.grams || 0) * Number(run.amount) * wasteFactor;
          await db.colors.update(color.id, { stock: Number(color.stock || 0) - usedGrams });
        }
      }
    }

    setRun({
      productId: "",
      printerId: settings.printers?.[0]?.id || "default-printer",
      amount: 1,
      sellingPrice: 0,
      notes: "",
      filamentUses: [],
    });
    setFilamentForm({ colorId: "", grams: 0 });
    await loadAll();
    showToast("Print opgeslagen");
  };

  const updateStock = async (id, value) => {
    await db.colors.update(id, { stock: Number(value) });
    await loadAll();
    showToast("Voorraad aangepast");
  };

  const addComponentToProduct = () => {
    const name = componentForm.name.trim();
    const cost = Number(componentForm.cost);

    if (!name) {
      showToast("Geef het onderdeel een naam", false);
      return;
    }

    if (cost < 0) {
      showToast("Onderdeelkost mag niet negatief zijn", false);
      return;
    }

    setProd((current) => ({
      ...current,
      components: [
        ...(current.components || []),
        {
          id: crypto.randomUUID(),
          name,
          cost,
        },
      ],
    }));
    setComponentForm({ name: "", cost: 0 });
  };

  const removeComponentFromProduct = (componentId) => {
    setProd((current) => ({
      ...current,
      components: (current.components || []).filter((component) => component.id !== componentId),
    }));
  };

  const addFilamentUseToPrint = () => {
    const colorId = Number(filamentForm.colorId);
    const grams = Number(filamentForm.grams);

    if (!colorId || grams <= 0) {
      showToast("Kies een kleur en geef gramverbruik op", false);
      return;
    }

    setRun((current) => ({
      ...current,
      filamentUses: [...(current.filamentUses || []), { id: crypto.randomUUID(), colorId, grams }],
    }));
    setFilamentForm({ colorId: "", grams: 0 });
  };

  const removeFilamentUseFromPrint = (filamentUseId) => {
    setRun((current) => ({
      ...current,
      filamentUses: (current.filamentUses || []).filter((use) => use.id !== filamentUseId),
    }));
  };

  // ---------- LIVE ----------
  const live = useMemo(() => {
    const product = products.find((entry) => entry.id == run.productId);

    if (!product) {
      return {
        filament: 0,
        parts: 0,
        electricity: 0,
        labor: 0,
        overhead: 0,
        depreciation: 0,
        cost: 0,
        revenue: 0,
        profit: 0,
        suggested: 0,
        filamentEntries: [],
      };
    }

    const breakdown = calcCostBreakdown(product, Number(run.amount || 0), run.filamentUses, purchases, settings, run.printerId);
    const revenue = Number(run.sellingPrice || 0) * Number(run.amount || 0);
    const suggested = breakdown.total * (1 + (settings.margin || 30) / 100);

    return {
      ...breakdown,
      cost: breakdown.total,
      revenue,
      profit: revenue - breakdown.total,
      suggested,
    };
  }, [products, purchases, run, settings]);

  // ---------- DASHBOARD ----------
  const printAnalytics = prints
    .map((print) => {
      const product = products.find((entry) => entry.id == print.productId);

      if (!product) {
        return null;
      }

      const filamentUses = getFilamentUsesForRecord(print, product);
      const costBreakdown = calcCostBreakdown(product, Number(print.amount), filamentUses, purchases, settings, print.printerId);
      const revenue = Number(print.sellingPrice) * Number(print.amount);
      const profit = revenue - costBreakdown.total;
      return {
        id: print.id,
        name: product.name,
        productId: product.id,
        printerId: print.printerId || settings.printers?.[0]?.id || "default-printer",
        printerName: costBreakdown.printerName,
        date: print.date,
        amount: Number(print.amount),
        notes: print.notes || "",
        filamentUses,
        revenue,
        profit,
        cost: costBreakdown.total,
        filament: costBreakdown.filament,
        parts: costBreakdown.parts,
        electricity: costBreakdown.electricity,
        labor: costBreakdown.labor,
        overhead: costBreakdown.overhead,
        depreciation: costBreakdown.depreciation,
        averageProfitPerUnit: Number(print.amount) ? profit / Number(print.amount) : 0,
        marginPercent: revenue ? (profit / revenue) * 100 : 0,
      };
    })
    .filter(Boolean);

  const overviewRange = getDateRangeForPreset(overviewPeriod, overviewFrom, overviewTo);
  const filteredPrintAnalytics = printAnalytics.filter((entry) => isWithinDateRange(entry.date, overviewRange.from, overviewRange.to));
  const filteredPurchasesForOverview = purchases.filter((entry) => isWithinDateRange(entry.date, overviewRange.from, overviewRange.to));
  const filteredPartPurchasesForOverview = partPurchases.filter((entry) => isWithinDateRange(entry.date, overviewRange.from, overviewRange.to));

  const monthlyOverheadCost = (settings.overheads || [])
    .filter((entry) => entry.mode === "monthly")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const monthCountInRange = (() => {
    if (!overviewRange.from || !overviewRange.to) {
      return 1;
    }
    const from = new Date(overviewRange.from.getFullYear(), overviewRange.from.getMonth(), 1);
    const to = new Date(overviewRange.to.getFullYear(), overviewRange.to.getMonth(), 1);
    return Math.max(1, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1);
  })();
  const totalMonthlyOverheadForRange = monthlyOverheadCost * monthCountInRange;

  const chart = filteredPrintAnalytics.map((entry) => ({ name: entry.name, profit: entry.profit }));
  const total = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.profit, 0);
  const totalRevenue = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.revenue, 0);
  const totalCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.cost, 0);
  const totalFilamentCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.filament, 0);
  const totalProductPartCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.parts, 0);
  const totalElectricityCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.electricity, 0);
  const totalLaborCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.labor, 0);
  const totalOverheadCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.overhead, 0);
  const totalDepreciationCost = filteredPrintAnalytics.reduce((sum, entry) => sum + entry.depreciation, 0);
  const totalMaterialSpend = filteredPurchasesForOverview.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  const totalPartSpend = filteredPartPurchasesForOverview.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  const totalSupplySpend = totalMaterialSpend + totalPartSpend;
  const netResult =
    totalRevenue -
    totalSupplySpend -
    totalElectricityCost -
    totalLaborCost -
    totalOverheadCost -
    totalDepreciationCost -
    totalMonthlyOverheadForRange;
  const stockMaterialValue = colors.reduce((sum, color) => {
    const stock = Number(color.stock || 0);
    const pricePerKg = avgPricePerKg(purchases, color.id);
    return sum + (stock / 1000) * pricePerKg;
  }, 0);
  const stockPartValue = parts.reduce((sum, part) => {
    const relatedPurchases = partPurchases.filter((purchase) => purchase.partId == part.id);
    const totalAmount = relatedPurchases.reduce((amount, purchase) => amount + Number(purchase.amount || 0), 0);
    const totalSpent = relatedPurchases.reduce((amount, purchase) => amount + Number(purchase.price || 0), 0);
    const avgUnitCost = totalAmount ? totalSpent / totalAmount : 0;
    return sum + Number(part.stock || 0) * avgUnitCost;
  }, 0);

  // ---------- ANALYTICS ----------
  const avgPrices = materials.flatMap((material) =>
    colors
      .filter((color) => color.materialId == material.id)
      .map((color) => ({
        name: color.name,
        price: avgPricePerKg(purchases, color.id),
      })),
  );

  const filteredMaterials = materials.filter((material) => {
    const query = searchMaterials.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const materialMatch = material.name.toLowerCase().includes(query);
    const colorMatch = colors.some((color) => color.materialId == material.id && color.name.toLowerCase().includes(query));
    return materialMatch || colorMatch;
  });

  const filteredParts = parts.filter((part) => {
    const query = searchParts.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [part.name, part.category, part.notes]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
  });

  const filteredProducts = products.filter((product) => {
    const query = searchProducts.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const componentMatch = (product.components || []).some((component) => component.name?.toLowerCase().includes(query));
    return [product.name, product.link, product.notes]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query)) || componentMatch;
  });

  const recentPurchases = purchases.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const recentPartPurchases = partPurchases.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const recentPrints = prints.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const productMarginRows = filteredPrintAnalytics
    .reduce((map, entry) => {
      const current = map.get(entry.productId) || {
        productId: entry.productId,
        name: entry.name,
        printerNames: new Set(),
        revenue: 0,
        profit: 0,
        quantity: 0,
      };
      current.revenue += entry.revenue;
      current.profit += entry.profit;
      current.quantity += entry.amount;
      if (entry.printerName) {
        current.printerNames.add(entry.printerName);
      }
      map.set(entry.productId, current);
      return map;
    }, new Map())
    .values();
  const productMargins = Array.from(productMarginRows).map((entry) => ({
    ...entry,
    averageProfitPerUnit: entry.quantity ? entry.profit / entry.quantity : 0,
    marginPercent: entry.revenue ? (entry.profit / entry.revenue) * 100 : 0,
    printerNames: Array.from(entry.printerNames),
  }));
  const topMarginProducts = productMargins.slice().sort((a, b) => b.profit - a.profit).slice(0, 5);
  const lowMarginProducts = productMargins
    .filter((entry) => entry.quantity > 0)
    .slice()
    .sort((a, b) => a.averageProfitPerUnit - b.averageProfitPerUnit)
    .slice(0, 5);
  const timelineEntries = [
    ...filteredPurchasesForOverview.map((purchase) => {
      const color = colors.find((entry) => entry.id == purchase.colorId);
      const material = materials.find((entry) => entry.id == color?.materialId);
      return {
        id: `filament-${purchase.id}`,
        date: purchase.date,
        type: "filamentPurchase",
        label: color?.name || "Filament purchase",
        productId: "",
        materialId: color?.materialId || "",
        amount: -Number(purchase.price || 0),
        notes: purchase.notes || "",
        meta: `${material?.name || ""} ${purchase.grams}g`.trim(),
      };
    }),
    ...filteredPartPurchasesForOverview.map((purchase) => {
      const part = parts.find((entry) => entry.id == purchase.partId);
      return {
        id: `part-${purchase.id}`,
        date: purchase.date,
        type: "partPurchase",
        label: part?.name || "Part purchase",
        productId: "",
        materialId: "",
        amount: -Number(purchase.price || 0),
        notes: purchase.notes || "",
        meta: `${purchase.amount} pcs`,
      };
    }),
    ...filteredPrintAnalytics.map((entry) => {
      const materialIds = [...new Set(entry.filamentUses.map((use) => colors.find((color) => color.id == use.colorId)?.materialId).filter(Boolean))];
      return {
        id: `sale-${entry.id}`,
        date: entry.date,
        type: "sale",
        label: entry.name,
        productId: entry.productId,
        materialId: materialIds[0] || "",
        amount: entry.revenue,
        notes: entry.notes,
        meta: `${entry.amount} pcs | profit EUR ${entry.profit.toFixed(2)}`,
      };
    }),
    ...(totalMonthlyOverheadForRange > 0
      ? [
          {
            id: `overhead-${overviewPeriod}-${overviewFrom}-${overviewTo}`,
            date: overviewRange.to || new Date(),
            type: "overhead",
            label: "Monthly overhead allocation",
            productId: "",
            materialId: "",
            amount: -totalMonthlyOverheadForRange,
            notes: "",
            meta: `${monthCountInRange} month(s)`,
          },
        ]
      : []),
  ]
    .filter((entry) => {
      if (timelineTypeFilter !== "all" && entry.type !== timelineTypeFilter) {
        return false;
      }
      if (timelineProductFilter && `${entry.productId}` !== `${timelineProductFilter}`) {
        return false;
      }
      if (timelineMaterialFilter && `${entry.materialId}` !== `${timelineMaterialFilter}`) {
        return false;
      }
      if (timelineMonthFilter) {
        const monthValue = new Date(entry.date).toISOString().slice(0, 7);
        if (monthValue !== timelineMonthFilter) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background: toast.success ? "#16a34a" : "#dc2626",
            color: "white",
            padding: "10px 16px",
            borderRadius: 8,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            zIndex: 999,
          }}
        >
          {toast.message}
        </div>
      )}

      <div style={{ minHeight: "100vh", padding: 20, background: "#111827", color: "white" }}>
        <h1 style={{ marginTop: 0 }}>3D Print Manager</h1>
        <p style={{ marginTop: -8, marginBottom: 16, opacity: 0.7 }}>Versie {APP_VERSION}</p>

        <div style={{ marginBottom: 16 }}>
          <Btn onClick={() => setTab("materials")}>Materialen</Btn>
          <Btn onClick={() => setTab("inventory")}>Inkopen</Btn>
          <Btn onClick={() => setTab("parts")}>Overige onderdelen</Btn>
          <Btn onClick={() => setTab("products")}>Producten</Btn>
          <Btn onClick={() => setTab("prints")}>Print</Btn>
          <Btn onClick={() => setTab("dashboard")}>Overzicht</Btn>
          <Btn onClick={() => setTab("settings")}>Instellingen</Btn>
        </div>

        {tab === "materials" && (
          <Box>
            <In label="Materiaal naam" value={mName} onChange={(event) => setMName(event.target.value)} />
            <Btn onClick={addMaterial}>Toevoegen</Btn>
            <In label="Zoeken in materialen en kleuren" value={searchMaterials} onChange={(event) => setSearchMaterials(event.target.value)} />

            <In
              label="Kleur naam"
              value={cForm.name}
              onChange={(event) => setCForm({ ...cForm, name: event.target.value })}
            />
            <select
              value={cForm.materialId}
              onChange={(event) => setCForm({ ...cForm, materialId: event.target.value })}
              style={selectStyle}
            >
              <option value="">Kies materiaal</option>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
            <Btn onClick={addColor}>Toevoegen</Btn>

            <h3>Voorraad</h3>
            {filteredMaterials.map((material) => (
              <div key={material.id} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <strong>{material.name}</strong>
                  <Btn style={{ background: "#dc2626" }} onClick={() => deleteMaterial(material.id)}>
                    Verwijderen
                  </Btn>
                </div>

                {colors
                  .filter((color) => color.materialId == material.id)
                  .map((color) => (
                    <div
                      key={color.id}
                      style={{
                        color: Number(color.stock || 0) < 100 ? "#fca5a5" : "white",
                        marginBottom: 8,
                        padding: 10,
                        borderRadius: 8,
                        background: "#111827",
                      }}
                    >
                      <strong>{color.name}</strong> - {color.stock || 0} g
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        <Btn onClick={() => updateStock(color.id, Number(color.stock || 0) - 50)}>-50g</Btn>
                        <Btn onClick={() => updateStock(color.id, Number(color.stock || 0) + 50)}>+50g</Btn>
                        <input
                          type="number"
                          defaultValue={color.stock || 0}
                          style={{ ...inputStyle, width: 100 }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              updateStock(color.id, event.target.value);
                            }
                          }}
                        />
                        <Btn style={{ background: "#dc2626" }} onClick={() => deleteColor(color.id)}>
                          Verwijderen
                        </Btn>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </Box>
        )}

        {tab === "inventory" && (
          <Box>
            <select
              value={buy.colorId}
              onChange={(event) => setBuy({ ...buy, colorId: event.target.value })}
              style={selectStyle}
            >
              <option value="">Kleur</option>
              {materials.map((material) => (
                <optgroup key={material.id} label={material.name}>
                  {colors
                    .filter((color) => color.materialId == material.id)
                    .map((color) => (
                      <option key={color.id} value={color.id}>
                        {color.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <In label="Gram" type="number" value={buy.grams} onChange={(event) => setBuy({ ...buy, grams: event.target.value })} />
            <In label="Prijs" type="number" value={buy.price} onChange={(event) => setBuy({ ...buy, price: event.target.value })} />
            <In label="Notities" value={buy.notes} onChange={(event) => setBuy({ ...buy, notes: event.target.value })} />
            <Btn onClick={addPurchase}>Toevoegen</Btn>

            <h4>Recente filamentaankopen</h4>
            {recentPurchases.length === 0 && <p>Nog geen filamentaankopen.</p>}
            {recentPurchases.map((purchase) => {
              const color = colors.find((entry) => entry.id == purchase.colorId);
              return (
                <div key={purchase.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                  <div>
                    <strong>{color?.name || "Onbekende kleur"}</strong> - {purchase.grams}g - EUR {Number(purchase.price || 0).toFixed(2)}
                  </div>
                  {purchase.notes && <div style={{ opacity: 0.8, marginTop: 4 }}>{purchase.notes}</div>}
                </div>
              );
            })}
          </Box>
        )}

        {tab === "parts" && (
          <Box>
            <h3>Overige onderdelen</h3>
            <In label="Zoeken in onderdelen" value={searchParts} onChange={(event) => setSearchParts(event.target.value)} />
            <In
              label="Onderdeel naam"
              value={partForm.name}
              onChange={(event) => setPartForm({ ...partForm, name: event.target.value })}
            />
            <In
              label="Categorie"
              value={partForm.category}
              onChange={(event) => setPartForm({ ...partForm, category: event.target.value })}
            />
            <Btn onClick={addPart}>Toevoegen</Btn>

            <h4>Inkoop registreren</h4>
            <select
              value={partBuy.partId}
              onChange={(event) => setPartBuy({ ...partBuy, partId: event.target.value })}
              style={selectStyle}
            >
              <option value="">Onderdeel</option>
              {parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
            <In
              label="Aantal"
              type="number"
              value={partBuy.amount}
              onChange={(event) => setPartBuy({ ...partBuy, amount: event.target.value })}
            />
            <In
              label="Totale prijs"
              type="number"
              value={partBuy.price}
              onChange={(event) => setPartBuy({ ...partBuy, price: event.target.value })}
            />
            <In label="Notities" value={partBuy.notes} onChange={(event) => setPartBuy({ ...partBuy, notes: event.target.value })} />
            <Btn onClick={addPartPurchase}>Inkoop toevoegen</Btn>

            <h4>Recente onderdelenaankopen</h4>
            {recentPartPurchases.length === 0 && <p>Nog geen onderdelenaankopen.</p>}
            {recentPartPurchases.map((purchase) => {
              const part = parts.find((entry) => entry.id == purchase.partId);
              return (
                <div key={purchase.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                  <div>
                    <strong>{part?.name || "Onbekend onderdeel"}</strong> - {purchase.amount} stuks - EUR {Number(purchase.price || 0).toFixed(2)}
                  </div>
                  {purchase.notes && <div style={{ opacity: 0.8, marginTop: 4 }}>{purchase.notes}</div>}
                </div>
              );
            })}

            <h4>Voorraad</h4>
            {filteredParts.length === 0 && <p>Geen onderdelen gevonden.</p>}
            {filteredParts.map((part) => (
              <div
                key={part.id}
                style={{
                  marginBottom: 8,
                  padding: 10,
                  borderRadius: 8,
                  background: "#111827",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{part.name}</strong>
                  {part.category && <span style={{ opacity: 0.75 }}>({part.category})</span>}
                  <span>- {part.stock || 0} stuks</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  <Btn onClick={() => updatePartStock(part.id, Number(part.stock || 0) - 1)}>-1</Btn>
                  <Btn onClick={() => updatePartStock(part.id, Number(part.stock || 0) + 1)}>+1</Btn>
                  <input
                    type="number"
                    defaultValue={part.stock || 0}
                    style={{ ...inputStyle, width: 100 }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        updatePartStock(part.id, event.target.value);
                      }
                    }}
                  />
                  <Btn style={{ background: "#dc2626" }} onClick={() => deletePart(part.id)}>
                    Verwijderen
                  </Btn>
                </div>
              </div>
            ))}
          </Box>
        )}

        {tab === "products" && (
          <Box>
            <In label="Zoeken in producten" value={searchProducts} onChange={(event) => setSearchProducts(event.target.value)} />
            <In label="Naam" value={prod.name} onChange={(event) => setProd({ ...prod, name: event.target.value })} />
            <In
              label="Printtijd"
              type="number"
              value={prod.printTime}
              onChange={(event) => setProd({ ...prod, printTime: event.target.value })}
            />
            <In
              label="Werkuren"
              type="number"
              value={prod.workTime}
              onChange={(event) => setProd({ ...prod, workTime: event.target.value })}
            />
            <In label="Link" value={prod.link} onChange={(event) => setProd({ ...prod, link: event.target.value })} />
            <In
              label="Afbeelding URL"
              value={prod.image}
              onChange={(event) => setProd({ ...prod, image: event.target.value })}
            />
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Notities</label>
              <textarea
                value={prod.notes}
                onChange={(event) => setProd({ ...prod, notes: event.target.value })}
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
            <h3>Onderdelen per product</h3>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(120px, 1fr) auto", gap: 10, alignItems: "end" }}>
              <In
                label="Onderdeel naam"
                value={componentForm.name}
                onChange={(event) => setComponentForm({ ...componentForm, name: event.target.value })}
              />
              <In
                label="Kostprijs"
                type="number"
                value={componentForm.cost}
                onChange={(event) => setComponentForm({ ...componentForm, cost: Number(event.target.value) })}
              />
              <Btn onClick={addComponentToProduct}>Onderdeel toevoegen</Btn>
            </div>
            {(prod.components || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {(prod.components || []).map((component) => (
                  <div
                    key={component.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      padding: 10,
                      marginBottom: 8,
                      borderRadius: 8,
                      background: "#111827",
                    }}
                  >
                    <span>
                      {component.name} - EUR {Number(component.cost || 0).toFixed(2)}
                    </span>
                    <Btn style={{ background: "#dc2626" }} onClick={() => removeComponentFromProduct(component.id)}>
                      Verwijderen
                    </Btn>
                  </div>
                ))}
                <p style={{ marginBottom: 0 }}>
                  Onderdelenkosten per stuk: EUR {getComponentCostPerUnit(prod).toFixed(2)}
                </p>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <Btn onClick={saveProduct}>{editProduct ? "Bijwerken" : "Opslaan"}</Btn>
              {editProduct && (
                <Btn
                  style={{ background: "#4b5563" }}
                  onClick={() => {
                    setEditProduct(null);
                    setProd({ name: "", printTime: 0, workTime: 0, link: "", image: "", notes: "", components: [] });
                    setComponentForm({ name: "", cost: 0 });
                  }}
                >
                  Annuleren
                </Btn>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  style={{
                    border: "1px solid #4b5563",
                    padding: 12,
                    borderRadius: 10,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                    background: "#111827",
                  }}
                >
                  {product.image && (
                    <img
                      src={product.image}
                      alt={product.name}
                      style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
                    />
                  )}
                  <div style={{ fontWeight: "bold", marginBottom: 6 }}>{product.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {product.printTime}u | {product.workTime}u werk
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                    Onderdelen: EUR {getComponentCostPerUnit(product).toFixed(2)} per stuk
                  </div>
                  {product.notes && <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>{product.notes}</div>}
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <Btn onClick={() => startEdit(product)}>Bewerken</Btn>
                    {product.link && (
                      <a href={product.link} target="_blank" rel="noreferrer">
                        <Btn>Open link</Btn>
                      </a>
                    )}
                    <Btn style={{ background: "#dc2626" }} onClick={() => deleteProduct(product.id)}>
                      Verwijderen
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </Box>
        )}

        {tab === "prints" && (
          <Box>
            <select
              value={run.productId}
              onChange={(event) => setRun({ ...run, productId: event.target.value })}
              style={selectStyle}
            >
              <option value="">Product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>

            <select
              value={run.printerId}
              onChange={(event) => setRun({ ...run, printerId: event.target.value })}
              style={selectStyle}
            >
              <option value="">Printer</option>
              {(settings.printers || []).map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
            </select>

            <In
              label="Aantal"
              type="number"
              value={run.amount}
              onChange={(event) => setRun({ ...run, amount: Number(event.target.value) })}
            />
            <In
              label="Verkoopprijs"
              type="number"
              value={run.sellingPrice}
              onChange={(event) => setRun({ ...run, sellingPrice: Number(event.target.value) })}
            />
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Notities</label>
              <textarea
                value={run.notes}
                onChange={(event) => setRun({ ...run, notes: event.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <h3>Filamentgebruik per print</h3>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(120px, 1fr) auto", gap: 10, alignItems: "end" }}>
              <div>
                <label style={{ display: "block", marginBottom: 6 }}>Kleur</label>
                <select
                  value={filamentForm.colorId}
                  onChange={(event) => setFilamentForm({ ...filamentForm, colorId: event.target.value })}
                  style={selectStyle}
                >
                  <option value="">Kies kleur</option>
                  {materials.map((material) => (
                    <optgroup key={material.id} label={material.name}>
                      {colors
                        .filter((color) => color.materialId == material.id)
                        .map((color) => (
                          <option key={color.id} value={color.id}>
                            {color.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <In
                label="Gram per print"
                type="number"
                value={filamentForm.grams}
                onChange={(event) => setFilamentForm({ ...filamentForm, grams: Number(event.target.value) })}
              />
              <Btn onClick={addFilamentUseToPrint}>Kleur toevoegen</Btn>
            </div>

            {(run.filamentUses || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {(run.filamentUses || []).map((use) => {
                  const color = colors.find((entry) => entry.id == use.colorId);
                  return (
                    <div
                      key={use.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        marginBottom: 8,
                        borderRadius: 8,
                        background: "#111827",
                      }}
                    >
                      <span>
                        {color?.name || "Onbekende kleur"} - {Number(use.grams || 0).toFixed(2)}g per print
                      </span>
                      <Btn style={{ background: "#dc2626" }} onClick={() => removeFilamentUseFromPrint(use.id)}>
                        Verwijderen
                      </Btn>
                    </div>
                  );
                })}
              </div>
            )}

            {live.filamentEntries.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {live.filamentEntries.map((entry) => {
                  const color = colors.find((item) => item.id == entry.colorId);
                  return (
                    <p key={`live-filament-${entry.colorId}`} style={{ margin: "4px 0" }}>
                      {color?.name || "Onbekende kleur"}: {entry.gramsTotal.toFixed(2)}g totaal - EUR {entry.cost.toFixed(2)}
                    </p>
                  );
                })}
              </div>
            )}

            <p>Filament: EUR {live.filament.toFixed(2)}</p>
            <p>Onderdelen: EUR {live.parts.toFixed(2)}</p>
            <p>Stroom: EUR {live.electricity.toFixed(2)}</p>
            <p>Arbeid: EUR {live.labor.toFixed(2)}</p>
            <p>Overhead: EUR {live.overhead.toFixed(2)}</p>
            <p>Afschrijving: EUR {live.depreciation.toFixed(2)}</p>
            <p>Kost totaal: EUR {live.cost.toFixed(2)}</p>
            <p>Aanbevolen prijs: EUR {live.suggested.toFixed(2)}</p>
            <p style={{ color: live.profit < 0 ? "#fca5a5" : "#86efac" }}>Winst: EUR {live.profit.toFixed(2)}</p>

            <Btn onClick={addPrint}>Opslaan</Btn>

            <h4>Recente prints</h4>
            {recentPrints.length === 0 && <p>Nog geen prints opgeslagen.</p>}
            {recentPrints.map((print) => {
              const product = products.find((entry) => entry.id == print.productId);
              return (
                <div key={print.id} style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                  <div>
                    <strong>{product?.name || "Onbekend product"}</strong> - {print.amount} stuks - EUR {Number(print.sellingPrice || 0).toFixed(2)}
                  </div>
                  {print.notes && <div style={{ opacity: 0.8, marginTop: 4 }}>{print.notes}</div>}
                </div>
              );
            })}
          </Box>
        )}

        {tab === "dashboard" && (
          <Box>
            <h3>Overzicht</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              <Btn onClick={() => setOverviewPeriod("today")} style={{ background: overviewPeriod === "today" ? "#1d4ed8" : "#374151" }}>
                Vandaag
              </Btn>
              <Btn onClick={() => setOverviewPeriod("week")} style={{ background: overviewPeriod === "week" ? "#1d4ed8" : "#374151" }}>
                Deze week
              </Btn>
              <Btn onClick={() => setOverviewPeriod("month")} style={{ background: overviewPeriod === "month" ? "#1d4ed8" : "#374151" }}>
                Deze maand
              </Btn>
              <Btn onClick={() => setOverviewPeriod("year")} style={{ background: overviewPeriod === "year" ? "#1d4ed8" : "#374151" }}>
                Dit jaar
              </Btn>
              <Btn onClick={() => setOverviewPeriod("custom")} style={{ background: overviewPeriod === "custom" ? "#1d4ed8" : "#374151" }}>
                Custom
              </Btn>
            </div>
            {overviewPeriod === "custom" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
                <In label="Van" type="date" value={overviewFrom} onChange={(event) => setOverviewFrom(event.target.value)} />
                <In label="Tot" type="date" value={overviewTo} onChange={(event) => setOverviewTo(event.target.value)} />
              </div>
            )}
            <p>Totale omzet uit verkopen: EUR {totalRevenue.toFixed(2)}</p>
            <p>Materiaalverbruik in verkochte prints: EUR {totalFilamentCost.toFixed(2)}</p>
            <p>Productonderdelen in verkochte prints: EUR {totalProductPartCost.toFixed(2)}</p>
            <p>Stroomkosten in verkochte prints: EUR {totalElectricityCost.toFixed(2)}</p>
            <p>Arbeidskosten in verkochte prints: EUR {totalLaborCost.toFixed(2)}</p>
            <p>Overhead per order in verkochte prints: EUR {totalOverheadCost.toFixed(2)}</p>
            <p>Afschrijving in verkochte prints: EUR {totalDepreciationCost.toFixed(2)}</p>
            <p>Maandelijkse overhead in periode: EUR {totalMonthlyOverheadForRange.toFixed(2)}</p>
            <p>Totale kostprijs van verkochte prints: EUR {totalCost.toFixed(2)}</p>
            <p>Brutowinst op verkochte prints: EUR {total.toFixed(2)}</p>

            <h4>Inkoop en cashflow</h4>
            <p>Totale materiaalinkoop: EUR {totalMaterialSpend.toFixed(2)}</p>
            <p>Totale overige onderdeleninkoop: EUR {totalPartSpend.toFixed(2)}</p>
            <p>Totale inkoopuitgaven: EUR {totalSupplySpend.toFixed(2)}</p>
            <p style={{ color: netResult < 0 ? "#fca5a5" : "#86efac" }}>Netto resultaat inclusief inkopen: EUR {netResult.toFixed(2)}</p>

            <h4>Voorraadwaarde</h4>
            <p>Filamentvoorraad op basis van gemiddelde inkoopprijs: EUR {stockMaterialValue.toFixed(2)}</p>
            <p>Overige onderdelenvoorraad op basis van gemiddelde inkoopprijs: EUR {stockPartValue.toFixed(2)}</p>

            <BarChart width={400} height={250} data={chart}>
              <XAxis dataKey="name" stroke="#d1d5db" />
              <YAxis stroke="#d1d5db" />
              <Tooltip />
              <Bar dataKey="profit" fill="#60a5fa" />
            </BarChart>

            <h4>Beste producten</h4>
            {chart
              .slice()
              .sort((a, b) => b.profit - a.profit)
              .slice(0, 3)
              .map((entry) => (
                <div key={`best-${entry.name}`}>
                  {entry.name}: EUR {entry.profit.toFixed(2)}
                </div>
              ))}

            <h4>Slechtste producten</h4>
            {chart
              .slice()
              .sort((a, b) => a.profit - b.profit)
              .slice(0, 3)
              .map((entry) => (
                <div key={`worst-${entry.name}`} style={{ color: "#fca5a5" }}>
                  {entry.name}: EUR {entry.profit.toFixed(2)}
                </div>
              ))}
            <h4>Top winstmakers</h4>
            {topMarginProducts.length === 0 && <p>Geen productdata in deze periode.</p>}
            {topMarginProducts.map((entry) => (
              <div key={`top-product-${entry.productId}`} style={{ marginBottom: 8 }}>
                {entry.name}: EUR {entry.profit.toFixed(2)} totaal | EUR {entry.averageProfitPerUnit.toFixed(2)} per stuk | {entry.marginPercent.toFixed(1)}%
              </div>
            ))}

            <h4>Lage marge bij verkochte producten</h4>
            {lowMarginProducts.length === 0 && <p>Geen productdata in deze periode.</p>}
            {lowMarginProducts.map((entry) => (
              <div key={`low-margin-${entry.productId}`} style={{ marginBottom: 8, color: "#fca5a5" }}>
                {entry.name}: {entry.quantity} stuks | EUR {entry.averageProfitPerUnit.toFixed(2)} per stuk | {entry.marginPercent.toFixed(1)}%
              </div>
            ))}

            <h4>Gemiddelde prijs per kilo</h4>
            {avgPrices.length === 0 && <p>Nog geen prijsdata beschikbaar.</p>}
            {avgPrices.map((entry) => (
              <div key={entry.name}>
                {entry.name}: EUR {entry.price.toFixed(2)}/kg
              </div>
            ))}

            <h4>Transactietijdlijn</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6 }}>Type</label>
                <select value={timelineTypeFilter} onChange={(event) => setTimelineTypeFilter(event.target.value)} style={selectStyle}>
                  <option value="all">Alle types</option>
                  <option value="sale">Verkopen</option>
                  <option value="filamentPurchase">Filamentaankopen</option>
                  <option value="partPurchase">Overige onderdelenaankopen</option>
                  <option value="overhead">Maandelijkse overhead</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6 }}>Product</label>
                <select value={timelineProductFilter} onChange={(event) => setTimelineProductFilter(event.target.value)} style={selectStyle}>
                  <option value="">Alle producten</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 6 }}>Materiaal</label>
                <select value={timelineMaterialFilter} onChange={(event) => setTimelineMaterialFilter(event.target.value)} style={selectStyle}>
                  <option value="">Alle materialen</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name}
                    </option>
                  ))}
                </select>
              </div>
              <In label="Maand" type="month" value={timelineMonthFilter} onChange={(event) => setTimelineMonthFilter(event.target.value)} />
            </div>
            {timelineEntries.length === 0 && <p>Geen transacties gevonden voor de huidige filters.</p>}
            {timelineEntries.map((entry) => (
              <div key={entry.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong>{entry.label}</strong>
                  <span style={{ color: entry.amount < 0 ? "#fca5a5" : "#86efac" }}>EUR {entry.amount.toFixed(2)}</span>
                </div>
                <div style={{ opacity: 0.8, marginTop: 4 }}>
                  {new Date(entry.date).toLocaleString()} | {entry.type} {entry.meta ? `| ${entry.meta}` : ""}
                </div>
                {entry.notes && <div style={{ opacity: 0.85, marginTop: 4 }}>{entry.notes}</div>}
              </div>
            ))}
          </Box>
        )}

        {tab === "settings" && (
          <Box>
            <h4>Lokale bestandsopslag</h4>
            <p style={{ lineHeight: 1.5 }}>
              Koppel deze app aan een lokaal JSON-bestand. Daarna worden je gegevens automatisch daarin opgeslagen en kun je
              hetzelfde bestand later opnieuw openen, ook als browseropslag wordt gewist.
            </p>
            <p style={{ opacity: 0.8 }}>
              Status: {dataFileHandle ? `gekoppeld aan ${dataFileName || "databestand"}` : "nog geen databestand gekoppeld"}
              {dataFileHandle ? ` (${fileStorageReady ? "gereed" : "toestemming vereist"})` : ""}
            </p>
            <p style={{ opacity: 0.7, lineHeight: 1.5 }}>
              Vanwege browserbeveiliging kan de app je bestandsmap niet direct openen in Verkenner. Je kunt hieronder wel
              snel hetzelfde databestand opnieuw kiezen.
            </p>
            <div style={{ marginBottom: 16 }}>
              <Btn onClick={createLocalDataFile}>Nieuw databestand</Btn>
              <Btn onClick={openExistingDataFile}>Bestaand databestand openen</Btn>
              {dataFileHandle && <Btn onClick={reopenCurrentDataFile}>Huidig databestand opnieuw kiezen</Btn>}
              {dataFileHandle && <Btn onClick={() => void saveBoundFileNow(true)}>Nu opslaan</Btn>}
              {dataFileHandle && (
                <Btn style={{ background: "#4b5563" }} onClick={disconnectDataFile}>
                  Koppeling verwijderen
                </Btn>
              )}
            </div>
            <p style={{ opacity: 0.8 }}>
              Snapshotmap: {backupDirectoryHandle ? backupDirectoryName || "gekoppelde map" : "nog geen snapshotmap gekoppeld"}
            </p>
            <div style={{ marginBottom: 16 }}>
              <Btn onClick={chooseBackupDirectory}>Snapshotmap kiezen</Btn>
              {backupDirectoryHandle && <Btn onClick={() => void saveSnapshotToDirectory(true)}>Nu snapshot maken</Btn>}
              {backupDirectoryHandle && (
                <Btn style={{ background: "#4b5563" }} onClick={disconnectBackupDirectory}>
                  Snapshotmap loskoppelen
                </Btn>
              )}
            </div>
            {!supportsFileStorage && (
              <p style={{ color: "#fca5a5" }}>
                Deze browser ondersteunt geen directe bestandsopslag. Gebruik in dat geval handmatig export/import.
              </p>
            )}
            {!supportsDirectoryStorage && (
              <p style={{ color: "#fca5a5" }}>
                Deze browser ondersteunt geen aparte snapshotmap. Handmatige export blijft wel beschikbaar.
              </p>
            )}

            <h4>Kostinstellingen</h4>
            <In
              label="Stroomprijs"
              type="number"
              value={settings.electricityPrice}
              onChange={(event) => setSettings({ ...settings, electricityPrice: Number(event.target.value) })}
            />
            <In
              label="Uurloon"
              type="number"
              value={settings.hourlyRate}
              onChange={(event) => setSettings({ ...settings, hourlyRate: Number(event.target.value) })}
            />
            <In
              label="Marge (%)"
              type="number"
              value={settings.margin}
              onChange={(event) => setSettings({ ...settings, margin: Number(event.target.value) })}
            />
            <In
              label="Waste (%)"
              type="number"
              value={settings.waste}
              onChange={(event) => setSettings({ ...settings, waste: Number(event.target.value) })}
            />

            <h4>Printerprofielen</h4>
            <In label="Printer naam" value={printerForm.name} onChange={(event) => setPrinterForm({ ...printerForm, name: event.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <In
                label="Power laag"
                type="number"
                value={printerForm.powerLow}
                onChange={(event) => setPrinterForm({ ...printerForm, powerLow: Number(event.target.value) })}
              />
              <In
                label="Power midden"
                type="number"
                value={printerForm.powerMid}
                onChange={(event) => setPrinterForm({ ...printerForm, powerMid: Number(event.target.value) })}
              />
              <In
                label="Power hoog"
                type="number"
                value={printerForm.powerHigh}
                onChange={(event) => setPrinterForm({ ...printerForm, powerHigh: Number(event.target.value) })}
              />
            </div>
            <Btn onClick={addPrinterProfile}>Printer toevoegen</Btn>
            {(settings.printers || []).map((printer) => (
              <div key={printer.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                <div>
                  <strong>{printer.name}</strong> - laag {printer.powerLow}W | midden {printer.powerMid}W | hoog {printer.powerHigh}W
                </div>
                <Btn style={{ background: "#dc2626" }} onClick={() => removePrinterProfile(printer.id)}>
                  Verwijderen
                </Btn>
              </div>
            ))}

            <h4>Vaste overhead</h4>
            <In label="Naam" value={overheadForm.name} onChange={(event) => setOverheadForm({ ...overheadForm, name: event.target.value })} />
            <In
              label="Bedrag"
              type="number"
              value={overheadForm.amount}
              onChange={(event) => setOverheadForm({ ...overheadForm, amount: Number(event.target.value) })}
            />
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Type</label>
              <select value={overheadForm.mode} onChange={(event) => setOverheadForm({ ...overheadForm, mode: event.target.value })} style={selectStyle}>
                <option value="monthly">Per maand</option>
                <option value="perOrder">Per order</option>
              </select>
            </div>
            <Btn onClick={addOverhead}>Overhead toevoegen</Btn>
            {(settings.overheads || []).map((entry) => (
              <div key={entry.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                <div>
                  <strong>{entry.name}</strong> - EUR {Number(entry.amount || 0).toFixed(2)} {entry.mode === "monthly" ? "per maand" : "per order"}
                </div>
                <Btn style={{ background: "#dc2626" }} onClick={() => removeOverhead(entry.id)}>
                  Verwijderen
                </Btn>
              </div>
            ))}

            <h4>Afschrijving</h4>
            <In
              label="Naam"
              value={depreciationForm.name}
              onChange={(event) => setDepreciationForm({ ...depreciationForm, name: event.target.value })}
            />
            <In
              label="Bedrag"
              type="number"
              value={depreciationForm.amount}
              onChange={(event) => setDepreciationForm({ ...depreciationForm, amount: Number(event.target.value) })}
            />
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Type</label>
              <select
                value={depreciationForm.mode}
                onChange={(event) => setDepreciationForm({ ...depreciationForm, mode: event.target.value })}
                style={selectStyle}
              >
                <option value="perPrint">Per print</option>
                <option value="perHour">Per printuur</option>
              </select>
            </div>
            <Btn onClick={addDepreciation}>Afschrijving toevoegen</Btn>
            {(settings.depreciations || []).map((entry) => (
              <div key={entry.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: "#111827" }}>
                <div>
                  <strong>{entry.name}</strong> - EUR {Number(entry.amount || 0).toFixed(2)} {entry.mode === "perHour" ? "per uur" : "per print"}
                </div>
                <Btn style={{ background: "#dc2626" }} onClick={() => removeDepreciation(entry.id)}>
                  Verwijderen
                </Btn>
              </div>
            ))}
            <Btn onClick={saveSettings}>Opslaan</Btn>

            <h4>Handmatige backup</h4>
            <Btn onClick={exportData}>Export</Btn>
            <input type="file" accept="application/json" onChange={importData} style={{ display: "block", marginTop: 10 }} />
          </Box>
        )}
      </div>
    </>
  );
}
