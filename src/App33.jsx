// VERSION: v1.4.1 (FULL RESTORE + NEW FEATURES SAFE)

import { useEffect, useMemo, useState } from "react";
import Dexie from "dexie";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

// ---------- UI ----------
const Btn = ({ children, ...p }) => (
  <button {...p} style={{ margin:6,padding:"8px 12px",borderRadius:8,background:"#2563eb",color:"white",border:"none",cursor:"pointer"}}>
    {children}
  </button>
);

const In = ({ label, ...props }) => (
  <div style={{ marginBottom:10 }}>
    <label>{label}</label>
    <input {...props} style={{ width:"100%" }} />
  </div>
  
);

const Box = ({ children }) => (
  <div style={{ border:"1px solid #333", padding:10, marginBottom:10 }}>
    {children}
  </div>
);

// ---------- DB ----------
const db = new Dexie("3DPrintDB");
db.version(6).stores({
  materials:"++id,name",
  colors:"++id,materialId,name,stock",
  purchases:"++id,colorId,grams,price,date",
  products:"++id,name,grams,printTime,workTime,link,image",
  prints:"++id,productId,colorId,amount,sellingPrice,date",
  settings:"id"
});

// ---------- HELPERS ----------
const avgPricePerKg = (purchases, colorId) => {
  const list = purchases.filter(p => p.colorId == colorId);
  const grams = list.reduce((a,b)=>a + Number(b.grams||0),0);
  const total = list.reduce((a,b)=>a + Number(b.price||0),0);
  return grams ? (total/grams)*1000 : 0;
};

const calcCost = (p, amount, price, s) => {
  const grams = p.grams * amount * (1 + (s.waste||0)/100);
  const filament = (grams/1000)*price;
  const power = p.printTime < 2 ? s.powerLow : p.printTime < 6 ? s.powerMid : s.powerHigh;
  const electricity = (power/1000)*(p.printTime*amount)*s.electricityPrice;
  const labor = p.workTime * amount * s.hourlyRate;
  return filament + electricity + labor;
};

export default function App(){

const [toast,setToast]=useState(null);

const showToast = (msg, success=true)=>{
  setToast({msg, success});
  setTimeout(()=>setToast(null),2000);
};

const [tab,setTab]=useState("materials");

const [materials,setMaterials]=useState([]);
const [colors,setColors]=useState([]);
const [purchases,setPurchases]=useState([]);
const [products,setProducts]=useState([]);
const [prints,setPrints]=useState([]);

const [settings,setSettings]=useState({
  electricityPrice:0.30,
  hourlyRate:15,
  powerLow:150,
  powerMid:180,
  powerHigh:220,
  margin:30,
  waste:5
});

const [mName,setMName]=useState("");
const [cForm,setCForm]=useState({name:"",materialId:""});
const [buy,setBuy]=useState({colorId:"",grams:0,price:0});
const [prod,setProd]=useState({name:"",grams:0,printTime:0,workTime:0,link:"",image:""});
const [editProduct,setEditProduct]=useState(null);
const [run,setRun]=useState({productId:"",colorId:"",amount:1,sellingPrice:0});

useEffect(()=>{loadAll(); loadSettings(); mergeDuplicateMaterials();},[]);

async function loadAll(){

  setMaterials(await db.materials.toArray());
  setColors(await db.colors.toArray());
  setPurchases(await db.purchases.toArray());
  setProducts(await db.products.toArray());
  setPrints(await db.prints.toArray());
}

// ---------- FIX: merge duplicate materials ----------
async function mergeDuplicateMaterials(){
  const mats = await db.materials.toArray();
  const map = {};

  for(const m of mats){
    const key = m.name.toLowerCase();

    if(!map[key]){
      map[key] = m;
    } else {
      const primary = map[key];

      // move colors to primary material
      const cols = await db.colors.where("materialId").equals(m.id).toArray();
      for(const c of cols){
        await db.colors.update(c.id, { materialId: primary.id });
      }

      // delete duplicate material
      await db.materials.delete(m.id);
    }
  }
}

async function loadSettings(){
  const s = await db.settings.get(1);
  if(s) setSettings(s);
}

async function saveSettings(){
  await db.settings.put({...settings,id:1});
}

// ---------- BACKUP ----------
const exportData = async()=>{
  const data = {
    materials: await db.materials.toArray(),
    colors: await db.colors.toArray(),
    purchases: await db.purchases.toArray(),
    products: await db.products.toArray(),
    prints: await db.prints.toArray()
  };
  const blob = new Blob([JSON.stringify(data)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup.json";
  a.click();
};

const importData = async(e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  for(const key of Object.keys(data)){
    await db[key].bulkPut(data[key]);
  }
  loadAll();
};

// ---------- CRUD ----------
const addMaterial = async()=>{
  if(!mName) return;

  const exists = materials.find(m => m.name.toLowerCase() === mName.toLowerCase());
  if(exists) return;

  await db.materials.add({name:mName});
  setMName("");
  loadAll();
};

const deleteMaterial = async(id)=>{
  await db.materials.delete(id);
  const relatedColors = colors.filter(c=>c.materialId==id);
  for(const c of relatedColors){
    await db.colors.delete(c.id);
  }
  loadAll();
};

const deleteColor = async(id)=>{
  await db.colors.delete(id);
  loadAll();
};

const addColor = async()=>{
  const mat = materials.find(m=>m.id==cForm.materialId);
  const full = mat ? `${mat.name} - ${cForm.name}` : cForm.name;
  await db.colors.add({...cForm,name:full,stock:0});
  setCForm({name:"",materialId:""}); loadAll();
};

const addPurchase = async()=>{
  await db.purchases.add({...buy,grams:+buy.grams,price:+buy.price,date:new Date()});
  const c = colors.find(x=>x.id==buy.colorId);
  if(c) await db.colors.update(c.id,{stock:(c.stock||0)+ +buy.grams});
  setBuy({colorId:"",grams:0,price:0}); loadAll();
};

const saveProduct = async()=>{
  if(editProduct){ await db.products.update(editProduct.id, prod); setEditProduct(null);} 
  else { await db.products.add(prod);} 
  setProd({name:"",grams:0,printTime:0,workTime:0,link:"",image:""});
  loadAll();
};

const startEdit = (p)=>{ setEditProduct(p); setProd(p); };

const deleteProduct = async(id)=>{
  await db.products.delete(id);
  loadAll();
};

const addPrint = async()=>{
  await db.prints.add({...run,amount:+run.amount,sellingPrice:+run.sellingPrice,date:new Date()});
  const c = colors.find(x=>x.id==run.colorId);
  const p = products.find(x=>x.id==run.productId);
  if(c && p){ await db.colors.update(c.id,{stock:(c.stock||0)-(p.grams*run.amount)}); }
  setRun({productId:"",colorId:"",amount:1,sellingPrice:0}); loadAll();
};

const updateStock = async(id,val)=>{ await db.colors.update(id,{stock:+val}); loadAll(); };

// ---------- LIVE ----------
const live = useMemo(()=>{
  const p = products.find(x=>x.id==run.productId);
  const price = avgPricePerKg(purchases, run.colorId);
  if(!p || !price) return {cost:0,revenue:0,profit:0,suggested:0};

  const cost = calcCost(p, run.amount, price, settings);
  const revenue = run.sellingPrice * run.amount;
  const suggested = cost * (1 + (settings.margin || 30)/100);

  return {
    cost,
    revenue,
    profit: revenue - cost,
    suggested
  };
},[run,products,purchases,settings]);

// ---------- DASHBOARD ----------
const chart = prints.map(r=>{
  const p = products.find(x=>x.id==r.productId);
  const price = avgPricePerKg(purchases, r.colorId);
  if(!p || !price) return null;
  const profit = (r.sellingPrice*r.amount) - calcCost(p,r.amount,price,settings);
  return {name:p.name,profit};
}).filter(Boolean);

const total = chart.reduce((a,b)=>a+b.profit,0);

// ---------- ANALYTICS ----------
const avgPrices = materials.flatMap(mat =>
  colors
    .filter(c => c.materialId == mat.id)
    .map(c => ({
      name: c.name,
      price: avgPricePerKg(purchases, c.id)
    }))
);

return (
  <>
  {toast && (
    <div style={{position:"fixed",bottom:20,right:20,background:toast.success?"#16a34a":"#dc2626",color:"white",padding:"10px 16px",borderRadius:8,boxShadow:"0 2px 6px rgba(0,0,0,0.3)",zIndex:999}}>
      {toast.msg}
    </div>
  )}
<div style={{padding:20}}>

<div>
  <Btn onClick={()=>setTab("materials")}>Materialen</Btn>
  <Btn onClick={()=>setTab("inventory")}>Inkopen</Btn>
  <Btn onClick={()=>setTab("products")}>Producten</Btn>
  <Btn onClick={()=>setTab("prints")}>Print</Btn>
  <Btn onClick={()=>setTab("dashboard")}>Dashboard</Btn>
  <Btn onClick={()=>setTab("analytics")}>Analytics</Btn>
  <Btn onClick={()=>setTab("settings")}>Instellingen</Btn>
</div>

{/* MATERIALS */}
{tab==="materials" && (
<Box>
  <In label="Materiaal naam" value={mName} onChange={e=>setMName(e.target.value)} />
  <Btn onClick={addMaterial}>Toevoegen</Btn>

  <In label="Kleur naam" value={cForm.name} onChange={e=>setCForm({...cForm,name:e.target.value})} />
  <select onChange={e=>setCForm({...cForm,materialId:e.target.value})}>
    <option>Kies materiaal</option>
    {materials.map(m=>(<option key={m.id} value={m.id}>{m.name}</option>))}
  </select>
  <Btn onClick={addColor}>Toevoegen</Btn>

  <h3>Voorraad</h3>
  {materials.map(mat=>(
    <div key={mat.id}>
      <strong>{mat.name}</strong>
      <Btn style={{background:"#dc2626"}} onClick={()=>deleteMaterial(mat.id)}>🗑️</Btn>
      {colors.filter(c=>c.materialId==mat.id).map(c=>(
        <div key={c.id} style={{color:(c.stock||0)<100?"red":"white", marginBottom:6}}>
          <strong>{c.name}</strong> — {c.stock||0} g
          <div style={{display:"inline-flex", gap:6, marginLeft:10}}>
            <Btn onClick={()=>updateStock(c.id, (c.stock||0) - 50)}>-50g</Btn>
            <Btn onClick={()=>updateStock(c.id, (c.stock||0) + 50)}>+50g</Btn>
            <input
              type="number"
              defaultValue={c.stock||0}
              style={{width:80}}
              onKeyDown={(e)=>{
                if(e.key==="Enter"){
                  updateStock(c.id, e.target.value);
                }
              }}
            />
            <Btn onClick={()=>deleteColor(c.id)} style={{background:"#dc2626"}}>🗑️</Btn>
          </div>
        </div>
      ))}
    </div>
  ))}
</Box>
)}

{/* INVENTORY */}
{tab==="inventory" && (
<Box>
  <select onChange={e=>setBuy({...buy,colorId:e.target.value})}>
    <option>Kleur</option>
    {materials.map(mat => (
      <optgroup key={mat.id} label={mat.name}>
        {colors
          .filter(c => c.materialId == mat.id)
          .map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
      </optgroup>
    ))}
  </select>
  <In label="Gram" type="number" onChange={e=>setBuy({...buy,grams:e.target.value})} />
  <In label="Prijs" type="number" onChange={e=>setBuy({...buy,price:e.target.value})} />
  <Btn onClick={addPurchase}>Toevoegen</Btn>
</Box>
)}

{/* PRODUCTS */}
{tab==="products" && (
<Box>
  <In label="Naam" value={prod.name} onChange={e=>setProd({...prod,name:e.target.value})} />
  <In label="Gram" type="number" value={prod.grams} onChange={e=>setProd({...prod,grams:e.target.value})} />
  <In label="Printtijd" type="number" value={prod.printTime} onChange={e=>setProd({...prod,printTime:e.target.value})} />
  <In label="Werkuren" type="number" value={prod.workTime} onChange={e=>setProd({...prod,workTime:e.target.value})} />
  <In label="Link" value={prod.link} onChange={e=>setProd({...prod,link:e.target.value})} />
  <In label="Afbeelding URL" value={prod.image} onChange={e=>setProd({...prod,image:e.target.value})} />
  <Btn onClick={saveProduct}>Opslaan</Btn>

  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
    {products.map(p=>(
    <div key={p.id} style={{border:"1px solid #555",padding:12,borderRadius:10,boxShadow:"0 2px 6px rgba(0,0,0,0.3)",background:"#1f2937"}}>
      {p.image && (
        <img src={p.image} style={{width:"100%",height:120,objectFit:"cover",borderRadius:8,marginBottom:8}} />
      )}
      <div style={{fontWeight:"bold",marginBottom:6}}>{p.name}</div>
      <div style={{fontSize:12,opacity:0.8}}>
        {p.grams}g • {p.printTime}u • {p.workTime}u werk
      </div>
      <div style={{marginTop:8,display:"flex",gap:6}}>
        <Btn onClick={()=>startEdit(p)}>✏️</Btn>
        {p.link && (
          <a href={p.link} target="_blank" rel="noreferrer">
            <Btn>🔗</Btn>
          </a>
        )}
        <Btn onClick={()=>deleteProduct(p.id)} style={{background:"#dc2626"}}>🗑️</Btn>
      </div>
    </div>
  ))}
  </div>
</Box>
)}

{/* PRINT */}
{tab==="prints" && (
<Box>
  <select onChange={e=>setRun({...run,productId:e.target.value})}>
    <option>Product</option>
    {products.map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
  </select>

  <select onChange={e=>setRun({...run,colorId:e.target.value})}>
    <option>Kleur</option>
    {materials.map(mat => (
      <optgroup key={mat.id} label={mat.name}>
        {colors
          .filter(c => c.materialId == mat.id)
          .map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
      </optgroup>
    ))}
  </select>

  <In label="Aantal" type="number" value={run.amount} onChange={e=>setRun({...run,amount:+e.target.value})} />
  <In label="Verkoopprijs" type="number" value={run.sellingPrice} onChange={e=>setRun({...run,sellingPrice:+e.target.value})} />

  <p>Kost: €{live.cost.toFixed(2)}</p>
  <p>Aanbevolen prijs: €{live.suggested.toFixed(2)}</p>
  <p style={{color: live.profit<0?"red":"white"}}>Winst: €{live.profit.toFixed(2)}</p>

  <Btn onClick={addPrint}>Opslaan</Btn>
</Box>
)}

{/* DASHBOARD */}
{tab==="dashboard" && (
<Box>
  <p>Totale winst: €{total.toFixed(2)}</p>
  <BarChart width={400} height={250} data={chart}>
    <XAxis dataKey="name" />
    <YAxis />
    <Tooltip />
    <Bar dataKey="profit" />
  </BarChart>
</Box>
)}

{/* ANALYTICS */}
{tab==="analytics" && (
<Box>
  {avgPrices.map(a=>(
    <div key={a.name}>{a.name}: €{a.price.toFixed(2)}/kg</div>
  ))}
</Box>
)}

{/* SETTINGS */}
{tab==="settings" && (
<Box>
  <In label="Stroomprijs" type="number" value={settings.electricityPrice} onChange={e=>setSettings({...settings,electricityPrice:+e.target.value})} />
  <In label="Uurloon" type="number" value={settings.hourlyRate} onChange={e=>setSettings({...settings,hourlyRate:+e.target.value})} />
  <In label="Power laag" type="number" value={settings.powerLow} onChange={e=>setSettings({...settings,powerLow:+e.target.value})} />
  <In label="Power midden" type="number" value={settings.powerMid} onChange={e=>setSettings({...settings,powerMid:+e.target.value})} />
  <In label="Power hoog" type="number" value={settings.powerHigh} onChange={e=>setSettings({...settings,powerHigh:+e.target.value})} />
  <In label="Marge (%)" type="number" value={settings.margin} onChange={e=>setSettings({...settings,margin:+e.target.value})} />
  <In label="Waste (%)" type="number" value={settings.waste} onChange={e=>setSettings({...settings,waste:+e.target.value})} />
  <Btn onClick={saveSettings}>Opslaan</Btn>

  <h4>Backup</h4>
  <Btn onClick={exportData}>Export</Btn>
  <input type="file" onChange={importData} />
</Box>
)}

</div>
  </>
);
}
