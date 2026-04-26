// VERSION: v1.4.2

import { useEffect, useMemo, useState } from "react";
import Dexie from "dexie";
import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";

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

// ---------- HELPERS ----------
const avgPricePerKg = (purchases, colorId) => {
  const list = purchases.filter((purchase) => purchase.colorId == colorId);
  const grams = list.reduce((sum, purchase) => sum + Number(purchase.grams || 0), 0);
  const total = list.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  return grams ? (total / grams) * 1000 : 0;
};

const getComponentCostPerUnit = (product) =>
  (product.components || []).reduce((sum, component) => sum + Number(component.cost || 0), 0);

const calcCostBreakdown = (product, amount, pricePerKg, settings) => {
  const grams = Number(product.grams || 0) * amount * (1 + (settings.waste || 0) / 100);
  const filament = (grams / 1000) * pricePerKg;
  const power =
    product.printTime < 2
      ? settings.powerLow
      : product.printTime < 6
        ? settings.powerMid
        : settings.powerHigh;
  const electricity = (power / 1000) * (Number(product.printTime || 0) * amount) * settings.electricityPrice;
  const labor = Number(product.workTime || 0) * amount * settings.hourlyRate;
  const parts = getComponentCostPerUnit(product) * amount;
  return {
    filament,
    parts,
    electricity,
    labor,
    total: filament + parts + electricity + labor,
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
  });

  const [mName, setMName] = useState("");
  const [cForm, setCForm] = useState({ name: "", materialId: "" });
  const [buy, setBuy] = useState({ colorId: "", grams: 0, price: 0 });
  const [partForm, setPartForm] = useState({ name: "", category: "" });
  const [partBuy, setPartBuy] = useState({ partId: "", amount: 1, price: 0 });
  const [prod, setProd] = useState({ name: "", grams: 0, printTime: 0, workTime: 0, link: "", image: "", components: [] });
  const [editProduct, setEditProduct] = useState(null);
  const [run, setRun] = useState({ productId: "", colorId: "", amount: 1, sellingPrice: 0 });
  const [componentForm, setComponentForm] = useState({ name: "", cost: 0 });

  const showToast = (message, success = true) => {
    setToast({ message, success });
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(null), 2000);
  };

  useEffect(() => {
    async function init() {
      await mergeDuplicateMaterials();
      await loadSettings();
      await loadAll();
    }

    init();
  }, []);

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
      setSettings(stored);
    }
  }

  async function saveSettings() {
    await db.settings.put({ ...settings, id: 1 });
    showToast("Instellingen opgeslagen");
  }

  // ---------- BACKUP ----------
  const exportData = async () => {
    const data = {
      materials: await db.materials.toArray(),
      colors: await db.colors.toArray(),
      purchases: await db.purchases.toArray(),
      parts: await db.parts.toArray(),
      partPurchases: await db.partPurchases.toArray(),
      products: await db.products.toArray(),
      prints: await db.prints.toArray(),
      settings: [{ ...settings, id: 1 }],
    };

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

      for (const key of Object.keys(data)) {
        if (!db[key] || !Array.isArray(data[key])) {
          continue;
        }
        await db[key].bulkPut(data[key]);
      }

      await loadSettings();
      await loadAll();
      showToast("Backup geimporteerd");
    } catch {
      showToast("Import mislukt", false);
    } finally {
      event.target.value = "";
    }
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
      date: new Date(),
    });

    const color = colors.find((entry) => entry.id == buy.colorId);
    if (color) {
      await db.colors.update(color.id, { stock: Number(color.stock || 0) + Number(buy.grams) });
    }

    setBuy({ colorId: "", grams: 0, price: 0 });
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
      date: new Date(),
    });

    const part = parts.find((entry) => entry.id == partBuy.partId);
    if (part) {
      await db.parts.update(part.id, { stock: Number(part.stock || 0) + Number(partBuy.amount) });
    }

    setPartBuy({ partId: "", amount: 1, price: 0 });
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
      grams: Number(prod.grams),
      printTime: Number(prod.printTime),
      workTime: Number(prod.workTime),
      link: prod.link.trim(),
      image: prod.image.trim(),
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

    setProd({ name: "", grams: 0, printTime: 0, workTime: 0, link: "", image: "", components: [] });
    setComponentForm({ name: "", cost: 0 });
    await loadAll();
  };

  const startEdit = (product) => {
    setEditProduct(product);
    setProd({
      ...product,
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
    if (!run.productId || !run.colorId || !run.amount) {
      showToast("Kies product, kleur en aantal", false);
      return;
    }

    const product = products.find((entry) => entry.id == run.productId);
    const color = colors.find((entry) => entry.id == run.colorId);

    await db.prints.add({
      ...run,
      productId: Number(run.productId),
      colorId: Number(run.colorId),
      amount: Number(run.amount),
      sellingPrice: Number(run.sellingPrice),
      date: new Date(),
    });

    if (color && product) {
      await db.colors.update(color.id, { stock: Number(color.stock || 0) - Number(product.grams || 0) * Number(run.amount) });
    }

    setRun({ productId: "", colorId: "", amount: 1, sellingPrice: 0 });
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

  // ---------- LIVE ----------
  const live = useMemo(() => {
    const product = products.find((entry) => entry.id == run.productId);
    const pricePerKg = avgPricePerKg(purchases, run.colorId);

    if (!product) {
      return { filament: 0, parts: 0, electricity: 0, labor: 0, cost: 0, revenue: 0, profit: 0, suggested: 0 };
    }

    const breakdown = calcCostBreakdown(product, Number(run.amount || 0), pricePerKg, settings);
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
      const pricePerKg = avgPricePerKg(purchases, print.colorId);

      if (!product) {
        return null;
      }

      const costBreakdown = calcCostBreakdown(product, Number(print.amount), pricePerKg, settings);
      const revenue = Number(print.sellingPrice) * Number(print.amount);
      const profit = revenue - costBreakdown.total;
      return {
        name: product.name,
        revenue,
        profit,
        cost: costBreakdown.total,
        filament: costBreakdown.filament,
        parts: costBreakdown.parts,
        electricity: costBreakdown.electricity,
        labor: costBreakdown.labor,
      };
    })
    .filter(Boolean);

  const chart = printAnalytics.map((entry) => ({ name: entry.name, profit: entry.profit }));
  const total = printAnalytics.reduce((sum, entry) => sum + entry.profit, 0);
  const totalRevenue = printAnalytics.reduce((sum, entry) => sum + entry.revenue, 0);
  const totalCost = printAnalytics.reduce((sum, entry) => sum + entry.cost, 0);
  const totalFilamentCost = printAnalytics.reduce((sum, entry) => sum + entry.filament, 0);
  const totalProductPartCost = printAnalytics.reduce((sum, entry) => sum + entry.parts, 0);
  const totalElectricityCost = printAnalytics.reduce((sum, entry) => sum + entry.electricity, 0);
  const totalLaborCost = printAnalytics.reduce((sum, entry) => sum + entry.labor, 0);
  const totalMaterialSpend = purchases.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  const totalPartSpend = partPurchases.reduce((sum, purchase) => sum + Number(purchase.price || 0), 0);
  const totalSupplySpend = totalMaterialSpend + totalPartSpend;
  const netResult = totalRevenue - totalSupplySpend - totalElectricityCost - totalLaborCost;
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
            {materials.map((material) => (
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
            <Btn onClick={addPurchase}>Toevoegen</Btn>
          </Box>
        )}

        {tab === "parts" && (
          <Box>
            <h3>Overige onderdelen</h3>
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
            <Btn onClick={addPartPurchase}>Inkoop toevoegen</Btn>

            <h4>Voorraad</h4>
            {parts.length === 0 && <p>Nog geen overige onderdelen toegevoegd.</p>}
            {parts.map((part) => (
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
            <In label="Naam" value={prod.name} onChange={(event) => setProd({ ...prod, name: event.target.value })} />
            <In label="Gram" type="number" value={prod.grams} onChange={(event) => setProd({ ...prod, grams: event.target.value })} />
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
                    setProd({ name: "", grams: 0, printTime: 0, workTime: 0, link: "", image: "", components: [] });
                    setComponentForm({ name: "", cost: 0 });
                  }}
                >
                  Annuleren
                </Btn>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {products.map((product) => (
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
                    {product.grams}g | {product.printTime}u | {product.workTime}u werk
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                    Onderdelen: EUR {getComponentCostPerUnit(product).toFixed(2)} per stuk
                  </div>
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
              value={run.colorId}
              onChange={(event) => setRun({ ...run, colorId: event.target.value })}
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

            <p>Filament: EUR {live.filament.toFixed(2)}</p>
            <p>Onderdelen: EUR {live.parts.toFixed(2)}</p>
            <p>Stroom: EUR {live.electricity.toFixed(2)}</p>
            <p>Arbeid: EUR {live.labor.toFixed(2)}</p>
            <p>Kost totaal: EUR {live.cost.toFixed(2)}</p>
            <p>Aanbevolen prijs: EUR {live.suggested.toFixed(2)}</p>
            <p style={{ color: live.profit < 0 ? "#fca5a5" : "#86efac" }}>Winst: EUR {live.profit.toFixed(2)}</p>

            <Btn onClick={addPrint}>Opslaan</Btn>
          </Box>
        )}

        {tab === "dashboard" && (
          <Box>
            <h3>Overzicht</h3>
            <p>Totale omzet uit verkopen: EUR {totalRevenue.toFixed(2)}</p>
            <p>Materiaalverbruik in verkochte prints: EUR {totalFilamentCost.toFixed(2)}</p>
            <p>Productonderdelen in verkochte prints: EUR {totalProductPartCost.toFixed(2)}</p>
            <p>Stroomkosten in verkochte prints: EUR {totalElectricityCost.toFixed(2)}</p>
            <p>Arbeidskosten in verkochte prints: EUR {totalLaborCost.toFixed(2)}</p>
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
            <h4>Gemiddelde prijs per kilo</h4>
            {avgPrices.length === 0 && <p>Nog geen prijsdata beschikbaar.</p>}
            {avgPrices.map((entry) => (
              <div key={entry.name}>
                {entry.name}: EUR {entry.price.toFixed(2)}/kg
              </div>
            ))}
          </Box>
        )}

        {tab === "settings" && (
          <Box>
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
              label="Power laag"
              type="number"
              value={settings.powerLow}
              onChange={(event) => setSettings({ ...settings, powerLow: Number(event.target.value) })}
            />
            <In
              label="Power midden"
              type="number"
              value={settings.powerMid}
              onChange={(event) => setSettings({ ...settings, powerMid: Number(event.target.value) })}
            />
            <In
              label="Power hoog"
              type="number"
              value={settings.powerHigh}
              onChange={(event) => setSettings({ ...settings, powerHigh: Number(event.target.value) })}
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
            <Btn onClick={saveSettings}>Opslaan</Btn>

            <h4>Backup</h4>
            <Btn onClick={exportData}>Export</Btn>
            <input type="file" accept="application/json" onChange={importData} style={{ display: "block", marginTop: 10 }} />
          </Box>
        )}
      </div>
    </>
  );
}
