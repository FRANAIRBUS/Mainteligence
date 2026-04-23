#include "WebUi.h"

#include <ArduinoJson.h>
#include <Update.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <esp_ota_ops.h>
#include <esp_partition.h>
#endif

#include "IndustrialApp.h"

namespace industrial_v2 {

namespace {

bool gHttpOtaStarted = false;
String gHttpOtaErrorMessage;

const char APP_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LH Industrial V5</title>
<style>
:root{--bg:#08131a;--panel:#102630;--ink:#eef4f6;--muted:#93aab4;--line:#2d5868;--accent:#ff9340;--accent2:#11b7a1;--ok:#8ce08f;--warn:#ffd166;--danger:#ff7b7b;--shadow:0 18px 40px rgba(0,0,0,.28)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"Trebuchet MS","Gill Sans",sans-serif;background:radial-gradient(circle at top left,#244c59 0,#08131a 42%),linear-gradient(145deg,#08131a,#15303c 58%,#21414c);color:var(--ink);min-height:100vh;overflow-x:hidden}
button,input,select,textarea{font:inherit}
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
header{padding:24px 18px 10px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
header>div:first-child{min-width:0}
h1{margin:0;font-size:clamp(28px,4vw,42px);letter-spacing:.08em;text-transform:uppercase}
.sub{color:var(--muted);max-width:860px}
.wrap{padding:0 18px 24px;display:grid;gap:18px}
.hero,.panel{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.08);border-radius:18px;box-shadow:var(--shadow)}
.hero{padding:18px}
.hero-grid,.config-grid{display:grid;gap:12px}
.hero-grid{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.stat{padding:14px;border-radius:14px;background:rgba(6,17,24,.45);border:1px solid rgba(255,255,255,.06);overflow-wrap:anywhere;word-break:break-word}
.stat b{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.stat span{font-size:24px;font-weight:700}
.panel{padding:16px}
.panel h2{margin:0 0 14px;font-size:18px;text-transform:uppercase;letter-spacing:.08em}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.badge{padding:6px 10px;border-radius:999px;background:#10222b;border:1px solid rgba(255,255,255,.08);font-size:12px;letter-spacing:.08em;text-transform:uppercase;overflow-wrap:anywhere;word-break:break-word}
.badge.ok{color:var(--ok)}
.badge.warn{color:var(--warn)}
.badge.danger{color:#ff9a9a}
.grid-2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.controls{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));align-items:end}
.field{display:grid;gap:6px}
.field label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.field input,.field select,.field textarea{width:100%;padding:10px 12px;border-radius:12px;background:#08161d;color:var(--ink);border:1px solid var(--line);min-height:44px}
.field textarea{min-height:140px;resize:vertical}
.field.checkbox{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#08161d}
.field.checkbox label{margin:0;color:var(--ink)}
.hint,.footer-note{font-size:11px;color:var(--muted);overflow-wrap:anywhere;word-break:break-word}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.btn{padding:11px 16px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--accent),#ffb266);color:#20150b;font-weight:700;cursor:pointer;min-height:44px;touch-action:manipulation}
.btn.alt{background:linear-gradient(135deg,#1d4a59,#2d7a90);color:var(--ink)}
.btn.ghost{background:#0b1a21;color:var(--ink);border:1px solid var(--line)}
.btn.danger{background:linear-gradient(135deg,#c03f3f,#ff7a7a);color:#fff}
.relay-row,.sensor-table{display:grid;gap:10px}
.relay-row{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.relay-btn{padding:14px;border-radius:14px;border:1px solid var(--line);background:#08161d;color:var(--ink);cursor:pointer;min-height:44px;font-size:15px;font-weight:600;touch-action:manipulation}
.relay-btn.active{background:linear-gradient(135deg,#0d8f78,#14b498);border-color:#28d7b7}
.sensor-table{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.sensor-box{padding:12px;border-radius:14px;background:#08161d;border:1px solid var(--line);overflow-wrap:anywhere;word-break:break-word}
pre{margin:0;padding:14px;background:#061017;border:1px solid var(--line);border-radius:14px;min-height:200px;max-height:320px;overflow:auto;color:#d8e1e4;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.config-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.section-title{margin:0 0 10px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.1em}
.menu-row{display:grid;gap:10px;grid-template-columns:minmax(220px,1fr) repeat(2,minmax(160px,auto));align-items:end;margin-top:14px}
details{margin-top:12px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#08161d}
details summary{cursor:pointer;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:12px}
@media (max-width:900px){.grid-2{grid-template-columns:1fr}.hero-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.config-grid{grid-template-columns:1fr}.controls{grid-template-columns:1fr}.relay-row{grid-template-columns:repeat(2,minmax(0,1fr))}.sensor-table{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:720px){header{padding:14px 14px 8px;flex-direction:column;align-items:stretch}.wrap{padding:0 14px 18px;gap:14px}.hero,.panel{padding:14px;border-radius:14px}h1{font-size:24px;letter-spacing:.04em;line-height:1.15}.sub{font-size:14px;line-height:1.45}.toolbar{width:100%;gap:8px}.badge{flex:1 1 calc(50% - 8px);text-align:center;min-height:40px;display:flex;align-items:center;justify-content:center}.actions{flex-direction:column}.actions .btn,.actions a.btn{width:100%;min-height:46px}.hero-grid,.relay-row,.sensor-table,.config-grid,.controls,.menu-row{grid-template-columns:1fr}.stat span{font-size:20px}.field input,.field select,.field textarea{font-size:16px}.field textarea{min-height:120px}pre{min-height:160px;max-height:240px;font-size:12px}}
</style>
</head>
<body>
<header>
  <div>
    <h1>LH Industrial V5</h1>
    <div class="sub">EdgeUnified remains in charge of cooperative multitasking. V5 keeps provisioning by concatenated code and separated fields for a lighter firmware footprint.</div>
  </div>
  <div class="toolbar">
    <span class="badge" id="net-badge">Network</span>
    <span class="badge" id="mode-badge">Mode</span>
    <span class="badge" id="telemetry-badge">Telemetry</span>
    <span class="badge" id="cloud-badge">Cloud</span>
  </div>
</header>
<div class="wrap">

  <section class="panel" id="nav-panel">
    <h2>Menu</h2>
    <div class="footer-note">Abre cada area sin saturar la pantalla principal.</div>
    <div class="menu-row">
      <div class="field">
        <label for="page-select">Pagina</label>
        <select id="page-select">
          <option value="/app?page=main">Main control</option>
          <option value="/app?page=deviceinfo">Informacion del dispositivo</option>
          <option value="/app?page=network">Identidad y conectividad</option>
          <option value="/app?page=board">Configuracion placa</option>
          <option value="/app?page=mysql">Base datos MySQL</option>
          <option value="/app?page=modbus">Configuracion Modbus</option>
          <option value="/app?page=cloud">Cloud IoT provision</option>
        </select>
      </div>
      <a class="btn ghost" href="/setup">Setup Portal</a>
      <a class="btn ghost" href="/ota">OTA Upload</a>
    </div>
    <div class="footer-note" id="flash">Ready.</div>
  </section>

  <section class="hero" id="device-summary-panel">
    <h2>Informacion del dispositivo</h2>
    <div class="hero-grid" id="stats"></div>
  </section>

  <div class="grid-2">
    <section class="panel" id="quick-panel">
      <h2>Quick Control</h2>
      <div class="controls">
        <div class="field"><label for="quick-mode">Work Mode</label><select id="quick-mode"></select></div>
        <div class="field"><label for="quick-setpoint">Setpoint 1</label><input id="quick-setpoint" type="number" step="0.1"></div>
        <div class="field"><label for="quick-setpoint2">Setpoint 2</label><input id="quick-setpoint2" type="number" step="0.1"></div>
      </div>
      <div class="relay-row" id="relay-buttons"></div>
      <div class="actions">
        <button class="btn" id="apply-control">Apply Control</button>
        <button class="btn alt" id="reboot">Controlled Reboot</button>
        <button class="btn danger" id="factory-reset">Factory Reset</button>
      </div>
      <div id="quick-logic-wrap" hidden>
        <div class="section-title" id="quick-logic-title">Control Logic</div>
        <div class="footer-note" id="quick-logic-note">This section is shown on /app only while Work Mode is Thermostat.</div>
        <div id="quick-config-sections"></div>
        <div class="actions">
          <button class="btn" id="save-quick-config">Save Thermostat Logic</button>
          <button class="btn ghost" id="reload-quick-config">Reload Logic</button>
        </div>
      </div>
    </section>

    <section class="panel" id="runtime-panel">
      <h2>Sensores y estado</h2>
      <div class="sensor-table" id="sensor-table"></div>
    </section>

    <section class="panel" id="cloud-panel">
      <h2>Estado Cloud</h2>
      <div class="sensor-table" id="cloud-diag"></div>
      <div class="footer-note">This panel shows the exact cloud URLs currently loaded in the device, including length and endpoint validation (full path or short Maintelligence domains).</div>
    </section>
  </div>


  <section class="panel" id="config-panel">
    <h2 id="config-title">Configuration</h2>
    <div class="footer-note" id="config-note">Save writes immediately without automatic reboot. Reboot manually if you change pins, OTA password or low-level network behavior.</div>
    <div id="config-sections"></div>
    <div class="actions">
      <button class="btn" id="save-config">Save Configuration</button>
      <button class="btn ghost" id="reload-config">Reload From Device</button>
    </div>
  </section>

  <section class="panel" id="provisioning-panel">
    <h2>Cloud IoT Provision y parametros esenciales</h2>
    <div class="footer-note">Usa un codigo concatenado o los campos separados. Flujo recomendado: Cargar nueva provision, Revisar, Guardar provision cargada.</div>
    <div class="field">
      <label for="provisioning-code">Codigo completo concatenado</label>
      <textarea id="provisioning-code" placeholder='organizationId=...|assetId=...|deviceKey=...|bootstrapToken=...'></textarea>
    </div>
    <div class="actions">
      <button class="btn alt" id="apply-provisioning-code">Cargar nueva provision (codigo)</button>
      <button class="btn ghost" id="load-current-provisioning">Leer actual</button>
      <button class="btn" id="save-provisioning">Guardar provision cargada</button>
    </div>
    <div class="section-title">Manual separated fields</div>
    <div class="config-grid">
      <div class="field"><label for="provisioning-organization-id">Organization Id</label><input id="provisioning-organization-id" placeholder="burgerclub"></div>
      <div class="field"><label for="provisioning-asset-id">Asset Id</label><input id="provisioning-asset-id" placeholder="asset_doc_id"></div>
      <div class="field"><label for="provisioning-device-key">Device Key</label><input id="provisioning-device-key" placeholder="ASSET-..."></div>
      <div class="field"><label for="provisioning-bootstrap-token">Bootstrap Token</label><input id="provisioning-bootstrap-token" placeholder="temporary token"></div>
      <div class="field"><label for="provisioning-bootstrap-url">Bootstrap Url</label><input id="provisioning-bootstrap-url" placeholder="https://.../iotDeviceBootstrap"></div>
      <div class="field"><label for="provisioning-sync-url">Sync Url</label><input id="provisioning-sync-url" placeholder="https://.../iotDeviceSync"></div>
      <div class="field"><label for="provisioning-poll-ms">Poll Interval Ms</label><input id="provisioning-poll-ms" type="number" min="1000" step="1000" placeholder="15000"></div>
    </div>
    <div class="actions">
      <button class="btn alt" id="apply-provisioning-fields">Cargar nueva provision</button>
    </div>
    
  </section>

  <section class="panel" id="logs-panel">
    <h2>Logs</h2>
    <pre id="logs"></pre>
  </section>
</div>
<script>
const SELECTS={workMode:{0:'Disabled',1:'Thermostat',2:'Pushbutton',3:'Manual'},wifiUseDhcp:{1:'DHCP',0:'Static IP'},coolingMode:{1:'Cool',0:'Heat'},telemetryMode:{0:'Off',1:'JSON',2:'Legacy Form'},modbusMode:{0:'Off',1:'RTU Server',2:'TCP Server',3:'TCP to RTU',4:'Slave to Me',5:'Slave to Me Hybrid TCP Server'},relay2Mode:{0:'Disabled',1:'Always On',2:'Follow Relay1',3:'Follow Setpoint2'},relay3Mode:{0:'Disabled',1:'Defrost',2:'Alarm'}};
const ARRAY_SELECTS={sensorTypes:{0:'None',1:'DS18B20',2:'DHT11',3:'DHT22',4:'On/Off',5:'NTC',6:'PTC',7:'PT100',8:'Internal'}};
const SECTIONS=[
{id:'identity',title:'Identity and Access',fields:['hostName','adminUser','adminPass','enableMdns','enableOta','otaPassword','resetIfWifiMissing','scheduledRestartHours']},
{id:'connectivity',title:'Connectivity',fields:['wifiSsid','wifiPass','wifiUseDhcp','wifiStaticIp','wifiSubnetMask','wifiGateway','wifiDns1','wifiDns2','apPassword','keepApEnabled','wifiConnectTimeoutSec']},
{id:'board',title:'IO and Sensors',fields:['relayActiveHigh','inputPullup','inputDebounceMs','sensorPeriodMs','ds18b20WaitMs','analogAverageSamples','inputPins','relayPins','sensorPins','sensorTypes','sensorTempCalibrationX10','sensorHumCalibrationX10']},
{id:'controlMain',title:'Control Logic',fields:['coolingMode','differentialX10','highAlarmX10','lowAlarmX10','tempAlarmDelayMin','controlPeriodMs','defrostIntervalMin','defrostDurationMin','defrostStopX10','stopRelay1OnDefrost','stopRelay2OnDefrost','relay2Mode','relay3Mode']},
{id:'mysql',title:'MySQL / HTTP Telemetry',fields:['enableTelemetry','telemetryMode','telemetryEndpoint','telemetryApiKey','telemetryUser','telemetryPass','telemetryDbName','telemetryLocation','telemetryDeviceName','telemetryBearer','telemetryAllowInsecureTls','telemetryPeriodSec']},
{id:'cloud',title:'Cloud IoT / Firebase Bridge',fields:['enableCloudIot','iotOrganizationId','iotAssetId','iotDeviceKey','iotBootstrapToken','iotBootstrapUrl','iotSyncUrl','iotFirmwareVersion','iotCapabilities','allowInsecureTls','iotStoreTelemetry','iotPollSeconds']},
{id:'modbus',title:'Modbus Industrial',fields:['enableModbus','modbusMode','modbusUnitId','modbusRemoteUnitId','modbusPort','modbusTaskMs','modbusScale','modbusTcpScale','modbusRtuBaud','modbusTempRegisters','modbusHumRegisters','modbusRelayRegisters','modbusSetpointRegister','modbusStatusRegister']}
];
const PAGE_DEFS={
main:{title:'Control Logic',note:'This section is shown on /app only while Work Mode is Thermostat.',sections:['controlMain'],showQuick:true,showRuntime:true,showCloud:false,showProvisioning:false,showLogs:false,showSummary:false,showConfig:true},
deviceinfo:{title:'Informacion del dispositivo',note:'Estado del equipo, red y bridge cloud en una sola pagina.',sections:[],showQuick:false,showRuntime:false,showCloud:true,showProvisioning:false,showLogs:true,showSummary:true,showConfig:false},
network:{title:'Identidad y conectividad',note:'Identity and Access plus Connectivity in a dedicated page.',sections:['identity','connectivity'],showQuick:false,showRuntime:false,showCloud:false,showProvisioning:false,showLogs:false,showSummary:false,showConfig:true},
board:{title:'Configuracion avanzada de la placa',note:'Board IO, sensors and calibration parameters.',sections:['board'],showQuick:false,showRuntime:false,showCloud:false,showProvisioning:false,showLogs:false,showSummary:false,showConfig:true},
mysql:{title:'Base datos MySQL',note:'MySQL, JSON and HTTP telemetry parameters.',sections:['mysql'],showQuick:false,showRuntime:false,showCloud:false,showProvisioning:false,showLogs:false,showSummary:false,showConfig:true},
modbus:{title:'Configuracion Modbus',note:'Industrial Modbus RTU/TCP.',sections:['modbus'],showQuick:false,showRuntime:false,showCloud:false,showProvisioning:false,showLogs:false,showSummary:false,showConfig:true},
cloud:{title:'Cloud IoT Provision',note:'Provision y parametros esenciales para conectar el equipo.',sections:[],showQuick:false,showRuntime:false,showCloud:false,showProvisioning:true,showLogs:false,showSummary:false,showConfig:false}
};
const CURRENT_PAGE=(new URLSearchParams(location.search).get('page')||'main').toLowerCase();
function currentPageDef(){return PAGE_DEFS[CURRENT_PAGE]||PAGE_DEFS.main}
function sectionById(id){return SECTIONS.find(section=>section.id===id)}
const ARRAY_FIELDS=new Set(['inputPins','relayPins','sensorPins','sensorTypes','sensorTempCalibrationX10','sensorHumCalibrationX10','modbusTempRegisters','modbusMirrorTempRegisters','modbusHumRegisters','modbusMirrorHumRegisters','modbusRelayRegisters','modbusMirrorRelayRegisters']);
const TEXTAREA_FIELDS=new Set(['telemetryEndpoint','telemetryBearer','iotBootstrapUrl','iotSyncUrl','iotCapabilities']);
const PASSWORD_FIELDS=new Set(['adminPass','wifiPass','apPassword','otaPassword','telemetryPass','telemetryBearer','telemetryApiKey','iotBootstrapToken']);
const BOOL_FIELDS=new Set(['enableMdns','enableOta','resetIfWifiMissing','keepApEnabled','relayActiveHigh','inputPullup','stopRelay1OnDefrost','stopRelay2OnDefrost','enableTelemetry','enableCloudIot','telemetryAllowInsecureTls','allowInsecureTls','iotStoreTelemetry','enableModbus']);
const FIELD_MAXLEN={hostName:31,adminUser:15,adminPass:23,wifiSsid:39,wifiPass:63,wifiStaticIp:15,wifiSubnetMask:15,wifiGateway:15,wifiDns1:15,wifiDns2:15,apPassword:23,otaPassword:23,telemetryEndpoint:95,telemetryApiKey:47,telemetryUser:31,telemetryPass:31,telemetryDbName:31,telemetryLocation:39,telemetryDeviceName:39,telemetryBearer:95,iotOrganizationId:47,iotAssetId:47,iotDeviceKey:47,iotBootstrapToken:71,iotBootstrapUrl:127,iotSyncUrl:127,iotFirmwareVersion:39,iotCapabilities:127};
const FIELD_HINTS={};
const ARRAY_META={inputPins:{labels:['IN1','IN2','IN3','IN4']},relayPins:{labels:['REL1','REL2','REL3','REL4']},sensorPins:{labels:['S1','S2','S3','S4']},sensorTypes:{labels:['S1 type','S2 type','S3 type','S4 type']},sensorTempCalibrationX10:{labels:['S1 temp','S2 temp','S3 temp','S4 temp']},sensorHumCalibrationX10:{labels:['S1 hum','S2 hum']},modbusTempRegisters:{labels:['T1 reg','T2 reg','T3 reg','T4 reg']},modbusMirrorTempRegisters:{labels:['T1 reg','T2 reg','T3 reg','T4 reg']},modbusHumRegisters:{labels:['H1 reg','H2 reg']},modbusMirrorHumRegisters:{labels:['H1 reg','H2 reg']},modbusRelayRegisters:{labels:['R1 reg','R2 reg','R3 reg','R4 reg']},modbusMirrorRelayRegisters:{labels:['R1 reg','R2 reg','R3 reg','R4 reg']}};
const FIELD_LABELS={wifiUseDhcp:'STA IP Mode',coolingMode:'Operating Mode',tempAlarmDelayMin:'Alarm Delay (min)',modbusScale:'Slave scale',modbusTcpScale:'TCP scale',modbusMirrorTempRegisters:'Temp map',modbusTempRegisters:'Temp reg',modbusMirrorHumRegisters:'Hum map',modbusHumRegisters:'Hum reg',modbusMirrorRelayRegisters:'Relay map',modbusRelayRegisters:'Relay reg',modbusMirrorSetpointRegister:'Setpoint map reg',modbusSetpointRegister:'Setpoint reg',modbusMirrorStatusRegister:'Status map reg',modbusStatusRegister:'Status reg'};
const MAP_PAIR_ARRAY={modbusTempRegisters:'modbusMirrorTempRegisters',modbusHumRegisters:'modbusMirrorHumRegisters',modbusRelayRegisters:'modbusMirrorRelayRegisters'};
const MAP_PAIR_SCALAR={modbusSetpointRegister:'modbusMirrorSetpointRegister',modbusStatusRegister:'modbusMirrorStatusRegister'};
const SHORT_BOOTSTRAP_URL='https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap';
const SHORT_SYNC_URL='https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync';
let relayModel=[false,false,false,false];
let relayDirty=false;
let appConfig={};
function el(id){return document.getElementById(id)}
function flash(message,kind=''){const node=el('flash');node.textContent=message;node.style.color=kind==='error'?'#ff9a9a':kind==='ok'?'#8be08d':'#dbe7eb'}
function titleize(key){return FIELD_LABELS[key]||key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())}
function fieldValue(key,value){if(ARRAY_FIELDS.has(key))return Array.isArray(value)?value.join(', '):'';return value ?? ''}
function toNumber(value){const n=Number(value);return Number.isFinite(n)?n:0}
function isHybridModeSelected(){const modeNode=el('cfg-modbusMode');const mode=modeNode?toNumber(modeNode.value):toNumber(appConfig.modbusMode??0);return mode===5}
function fmt(value,digits=1){return value==null||Number.isNaN(value)?'--':Number(value).toFixed(digits)}
async function callApi(url,options={}){const opts={cache:'no-store',...options};if(opts.body&&!opts.headers){opts.headers={'Content-Type':'application/json'}}const res=await fetch(url,opts);if(!res.ok){throw new Error(await res.text()||res.statusText)}return res}
function telemetryBadgeKind(status){const value=String(status||'').toLowerCase();if(value.includes('ok')||value.includes('online')||value.includes('bootstrapped'))return'ok';if(value.includes('error')||value.includes('failed')||value.includes('blocked')||value.includes('missing'))return'danger';return'warn'}
function renderQuickMode(){const select=el('quick-mode');select.innerHTML='';Object.entries(SELECTS.workMode).forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option)})}
function renderRelayButtons(){const host=el('relay-buttons');host.innerHTML='';relayModel.forEach((state,index)=>{const button=document.createElement('button');button.className='relay-btn'+(state?' active':'');button.textContent='Relay '+(index+1)+' '+(state?'ON':'OFF');button.dataset.index=index;button.onclick=()=>{relayDirty=true;relayModel[index]=!relayModel[index];renderRelayButtons()};host.appendChild(button)})}
function statCard(label,value){return `<div class="stat"><b>${label}</b><span>${value}</span></div>`}
function renderStats(state){el('stats').innerHTML=[statCard('Platform',state.platform||'--'),statCard('IP',state.ipAddress||'offline'),statCard('SSID',state.connectedSsid||state.apSsid||'--'),statCard('AP',state.apModeActive?(state.apSsid||'active'):'off'),statCard('Heap',`${state.freeHeap||0} / ${state.minHeap||0}`),statCard('OTA',state.otaActive?'ready':'idle'),statCard('Loop',`${state.lastLoopUs||0} us`),statCard('Restart',state.lastRestartReason||'--')].join('');const net=el('net-badge');net.textContent=state.wifiConnected?`STA ${state.connectedSsid||state.ipAddress}`:(state.apModeActive?`AP ${state.apSsid||'active'}`:'Offline');net.className='badge '+(state.wifiConnected?'ok':(state.apModeActive?'warn':'danger'));const mode=el('mode-badge');mode.textContent='Mode '+(state.mode||'--');mode.className='badge';const tele=el('telemetry-badge');tele.textContent='Telemetry '+(state.lastTelemetryStatus||'--');tele.className='badge '+telemetryBadgeKind(state.lastTelemetryStatus);const cloud=el('cloud-badge');cloud.textContent='Cloud '+(state.lastCloudStatus||'--');cloud.className='badge '+telemetryBadgeKind(state.lastCloudStatus)}
function renderSensors(state){const host=el('sensor-table');host.innerHTML='';const temps=state.temperature||[];const hum=state.humidity||[];const relays=state.relayState||[];const inputs=state.inputState||[];for(let i=0;i<4;i++){const box=document.createElement('div');box.className='sensor-box';box.innerHTML=`<div class="section-title">Channel ${i+1}</div><div>T: <b>${temps[i]==null?'--':fmt(temps[i])} C</b></div><div>H: <b>${hum[i]==null?'--':fmt(hum[i])} %</b></div><div>Input: <b>${inputs[i]?'ON':'OFF'}</b></div><div>Relay: <b>${relays[i]?'ON':'OFF'}</b></div>`;host.appendChild(box)}}
function syncQuick(state){if(document.activeElement!==el('quick-setpoint'))el('quick-setpoint').value=state.setpoint??'';if(document.activeElement!==el('quick-setpoint2'))el('quick-setpoint2').value=state.setpoint2??'';if(document.activeElement!==el('quick-mode'))el('quick-mode').value=String(appConfig.workMode??0);updateMainControlVisibility();if(!relayDirty&&Array.isArray(state.manualRelayState)&&state.manualRelayState.length===4){relayModel=[...state.manualRelayState];renderRelayButtons()}}
function buildArrayField(key,value){const meta=ARRAY_META[key];const wrap=document.createElement('div');wrap.className='field';wrap.dataset.key=key;const label=document.createElement('label');label.textContent=titleize(key);wrap.appendChild(label);const values=Array.isArray(value)?value:[];const selectOptions=ARRAY_SELECTS[key];const pairMirrorKey=MAP_PAIR_ARRAY[key];if(pairMirrorKey&&isHybridModeSelected()){const sourceValues=Array.isArray(appConfig[pairMirrorKey])?appConfig[pairMirrorKey]:[];const rows=document.createElement('div');rows.style.display='grid';rows.style.gap='8px';meta.labels.forEach((caption,index)=>{const row=document.createElement('div');row.className='config-grid';row.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';const left=document.createElement('div');left.className='field';const leftLabel=document.createElement('label');leftLabel.textContent=`${caption}`;const leftInput=document.createElement('input');leftInput.type='number';leftInput.step='1';leftInput.value=sourceValues[index]??0;leftInput.dataset.arrayKey=pairMirrorKey;leftInput.dataset.arrayIndex=String(index);left.append(leftLabel,leftInput);const right=document.createElement('div');right.className='field';const rightLabel=document.createElement('label');rightLabel.textContent=`${caption.replace(' reg','')} map reg`;const rightInput=document.createElement('input');rightInput.type='number';rightInput.step='1';rightInput.value=values[index]??0;rightInput.dataset.arrayKey=key;rightInput.dataset.arrayIndex=String(index);right.append(rightLabel,rightInput);row.append(left,right);rows.appendChild(row)});wrap.appendChild(rows);if(FIELD_HINTS[pairMirrorKey]){const hint=document.createElement('div');hint.className='hint';hint.textContent=FIELD_HINTS[pairMirrorKey];wrap.appendChild(hint)}return wrap}const grid=document.createElement('div');grid.className='config-grid';meta.labels.forEach((caption,index)=>{const item=document.createElement('div');item.className='field';const itemLabel=document.createElement('label');itemLabel.textContent=caption;let input;if(selectOptions){input=document.createElement('select');Object.entries(selectOptions).forEach(([optionValue,optionLabel])=>{const option=document.createElement('option');option.value=optionValue;option.textContent=optionLabel;input.appendChild(option)});input.value=String(values[index]??0)}else{input=document.createElement('input');input.type='number';input.step='1';input.value=values[index]??0}input.dataset.arrayKey=key;input.dataset.arrayIndex=String(index);item.append(itemLabel,input);grid.appendChild(item)});wrap.appendChild(grid);if(FIELD_HINTS[key]){const hint=document.createElement('div');hint.className='hint';hint.textContent=FIELD_HINTS[key];wrap.appendChild(hint)}return wrap}
function buildField(key,value){if(ARRAY_META[key])return buildArrayField(key,value);const pairMirrorKey=MAP_PAIR_SCALAR[key];if(pairMirrorKey&&isHybridModeSelected()){const wrap=document.createElement('div');wrap.className='field';wrap.dataset.key=key;const label=document.createElement('label');label.textContent=titleize(key);wrap.appendChild(label);const row=document.createElement('div');row.className='config-grid';row.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';const left=document.createElement('div');left.className='field';const leftLabel=document.createElement('label');leftLabel.textContent='reg';const leftInput=document.createElement('input');leftInput.type='number';leftInput.step='1';leftInput.id='cfg-'+pairMirrorKey;leftInput.value=fieldValue(pairMirrorKey,appConfig[pairMirrorKey]);left.append(leftLabel,leftInput);const right=document.createElement('div');right.className='field';const rightLabel=document.createElement('label');rightLabel.textContent='map reg';const rightInput=document.createElement('input');rightInput.type='number';rightInput.step='1';rightInput.id='cfg-'+key;rightInput.value=fieldValue(key,value);right.append(rightLabel,rightInput);row.append(left,right);wrap.appendChild(row);if(FIELD_HINTS[pairMirrorKey]){const hint=document.createElement('div');hint.className='hint';hint.textContent=FIELD_HINTS[pairMirrorKey];wrap.appendChild(hint)}return wrap}const wrap=document.createElement('div');wrap.className=BOOL_FIELDS.has(key)?'field checkbox':'field';wrap.dataset.key=key;const label=document.createElement('label');label.htmlFor='cfg-'+key;label.textContent=titleize(key);if(BOOL_FIELDS.has(key)){const input=document.createElement('input');input.type='checkbox';input.id='cfg-'+key;input.checked=Boolean(value);wrap.append(input,label);return wrap}if(SELECTS[key]){const input=document.createElement('select');input.id='cfg-'+key;Object.entries(SELECTS[key]).forEach(([v,text])=>{const option=document.createElement('option');option.value=v;option.textContent=text;input.appendChild(option)});input.value=String(typeof value==='boolean'?(value?1:0):(value ?? 0));wrap.append(label,input)}else if(TEXTAREA_FIELDS.has(key)){const input=document.createElement('textarea');input.id='cfg-'+key;input.value=fieldValue(key,value);if(FIELD_MAXLEN[key])input.maxLength=FIELD_MAXLEN[key];wrap.append(label,input)}else{const input=document.createElement('input');input.id='cfg-'+key;input.type=PASSWORD_FIELDS.has(key)?'password':(typeof value==='number'?'number':'text');if(typeof value==='number')input.step='1';input.value=fieldValue(key,value);if(FIELD_MAXLEN[key])input.maxLength=FIELD_MAXLEN[key];wrap.append(label,input)}if(FIELD_HINTS[key]){const hint=document.createElement('div');hint.className='hint';hint.textContent=FIELD_HINTS[key];wrap.appendChild(hint)}return wrap}
function updateStaticIpFields(){const node=el('cfg-wifiUseDhcp');const dhcp=node?node.value!=='0':Boolean(appConfig.wifiUseDhcp);['wifiStaticIp','wifiSubnetMask','wifiGateway','wifiDns1','wifiDns2'].forEach(key=>{const wrap=document.querySelector(`[data-key="${key}"]`);if(wrap)wrap.hidden=dhcp})}
function setFieldHidden(key,hidden){const wrap=document.querySelector(`[data-key="${key}"]`);if(wrap)wrap.hidden=hidden}
function updateModbusModeFields(){const modeNode=el('cfg-modbusMode');const mode=modeNode?toNumber(modeNode.value):toNumber(appConfig.modbusMode??0);const isRtuServer=mode===1;const isTcpServer=mode===2;const isTcpBridge=mode===3;const isSlave=mode===4||mode===5;const isHybrid=mode===5;const showPublishMap=isRtuServer||isTcpServer||isTcpBridge||isHybrid||mode===4;const usesTcpScale=isTcpServer||isTcpBridge||isHybrid;setFieldHidden('modbusUnitId',!isRtuServer);setFieldHidden('modbusRemoteUnitId',!isSlave);setFieldHidden('modbusPort',!(isTcpServer||isTcpBridge||isHybrid));setFieldHidden('modbusTcpScale',!usesTcpScale);setFieldHidden('modbusTempRegisters',!showPublishMap);setFieldHidden('modbusHumRegisters',!showPublishMap);setFieldHidden('modbusRelayRegisters',!showPublishMap);setFieldHidden('modbusSetpointRegister',!showPublishMap);setFieldHidden('modbusStatusRegister',!showPublishMap);const note=el('config-note');if(CURRENT_PAGE==='modbus'&&note){note.textContent=isHybrid?'Hybrid: reg=source, map reg=publish.':'Industrial Modbus RTU/TCP.'}}
function updateMainControlVisibility(){if(CURRENT_PAGE!=='main'){el('quick-logic-wrap').hidden=true;return}const thermostat=Number(el('quick-mode')?.value ?? appConfig.workMode ?? 0)===1;el('quick-logic-wrap').hidden=!thermostat;el('config-panel').hidden=true}
function applyPageLayout(){const page=currentPageDef();el('config-title').textContent=page.title;el('config-note').textContent=page.note;el('quick-logic-title').textContent=page.title;el('quick-logic-note').textContent=page.note;el('device-summary-panel').hidden=!page.showSummary;el('quick-panel').hidden=!page.showQuick;el('runtime-panel').hidden=!page.showRuntime;el('cloud-panel').hidden=!page.showCloud;el('provisioning-panel').hidden=!page.showProvisioning;el('logs-panel').hidden=!page.showLogs;el('config-panel').hidden=!page.showConfig;updateMainControlVisibility()}
function renderConfig(){const page=currentPageDef();const quickRoot=el('quick-config-sections');const configRoot=el('config-sections');quickRoot.innerHTML='';configRoot.innerHTML='';const root=CURRENT_PAGE==='main'?quickRoot:configRoot;page.sections.forEach(sectionId=>{const section=sectionById(sectionId);if(!section)return;const panel=document.createElement('div');if(CURRENT_PAGE==='main'){panel.style.marginTop='14px'}else{panel.className='panel';panel.style.marginTop='14px'}const title=document.createElement('div');title.className='section-title';title.textContent=section.title;panel.appendChild(title);const grid=document.createElement('div');grid.className='config-grid';section.fields.forEach(key=>grid.appendChild(buildField(key,appConfig[key])));panel.appendChild(grid);root.appendChild(panel)});updateStaticIpFields();applyPageLayout();updateModbusModeFields()}
function readConfigField(key){if(ARRAY_META[key]){return Array.from(document.querySelectorAll(`[data-array-key="${key}"]`)).sort((a,b)=>Number(a.dataset.arrayIndex)-Number(b.dataset.arrayIndex)).map(node=>toNumber(node.value))}const node=el('cfg-'+key);if(!node)return appConfig[key];if(BOOL_FIELDS.has(key))return node.checked;if(key==='wifiUseDhcp'||key==='coolingMode')return node.value!=='0';if(SELECTS[key])return toNumber(node.value);if(typeof appConfig[key]==='number')return toNumber(node.value);return node.value}
function collectConfig(){const payload={...appConfig};currentPageDef().sections.forEach(sectionId=>{const section=sectionById(sectionId);if(!section)return;section.fields.forEach(key=>payload[key]=readConfigField(key))});Object.entries(MAP_PAIR_ARRAY).forEach(([,mirrorKey])=>payload[mirrorKey]=readConfigField(mirrorKey));Object.entries(MAP_PAIR_SCALAR).forEach(([,mirrorKey])=>payload[mirrorKey]=readConfigField(mirrorKey));return payload}
function normalizeEndpointValue(value,fallback=''){const text=String(value??'').trim()||String(fallback??'').trim();if(!text)return'';return /^https?:\/\//i.test(text)?text:`https://${text}`}
function endpointHost(url){try{return new URL(url).hostname.toLowerCase()}catch{return''}}
function endpointMatches(url,suffix,aliasHost){const normalized=normalizeEndpointValue(url);if(!normalized)return false;const lower=normalized.toLowerCase();if(suffix&&lower.endsWith(String(suffix).toLowerCase()))return true;return endpointHost(normalized)===String(aliasHost||'').toLowerCase()}
function endpointInfo(url,suffix,maxLen,aliasHost){const normalized=normalizeEndpointValue(url);return{value:normalized,length:normalized.length,validEndpoint:endpointMatches(normalized,suffix,aliasHost),withinLimit:normalized.length<=maxLen,empty:!normalized.length}}
function renderCloudDiagnostics(){const host=el('cloud-diag');if(!host)return;const bootstrap=endpointInfo(appConfig.iotBootstrapUrl,'/iotDeviceBootstrap',127,'devicebootstrap.maintelligence.app');const sync=endpointInfo(appConfig.iotSyncUrl,'/iotDeviceSync',127,'devicesync.maintelligence.app');const card=(label,value)=>`<div class="sensor-box"><div class="section-title">${label}</div><div><b>${value}</b></div></div>`;const busy=window.__lastState?.cloudBusy?'busy':'idle';const stack=window.__lastState?.cloudWorkerStackHighWater??0;const status=window.__lastState?.lastCloudStatus||'--';const error=window.__lastState?.lastCloudError||'none';const bootstrapped=Boolean(appConfig.iotBootstrapDone);const secretPresent=Boolean(String(appConfig.iotDeviceSecret||'').trim());const tokenPresent=Boolean(String(appConfig.iotBootstrapToken||'').trim());const authMode=bootstrapped&&secretPresent?'signed sync with device secret':(tokenPresent?'bootstrap token pending':'missing bootstrap credentials');host.innerHTML=[card('Cloud Enabled',appConfig.enableCloudIot?'yes':'no'),card('Organization',appConfig.iotOrganizationId||'--'),card('Asset',appConfig.iotAssetId||'--'),card('Device',appConfig.iotDeviceKey||'--'),card('Bootstrap State',bootstrapped?'bootstrapped':'bootstrap pending'),card('Auth Mode',authMode),card('Device Secret',secretPresent?'stored':'missing'),card('Bootstrap Token',tokenPresent?'loaded':'empty'),card('Bootstrap URL',`${bootstrap.value||'--'} | ${bootstrap.length}/127 ${bootstrap.validEndpoint?'endpoint-ok':'endpoint-error'}`),card('Sync URL',`${sync.value||'--'} | ${sync.length}/127 ${sync.validEndpoint?'endpoint-ok':'endpoint-error'}`),card('Last Desired Version',window.__lastState?.iotLastDesiredVersion??'--'),card('Cloud Status',status),card('Cloud Error',error),card('Cloud Worker',busy),card('Worker Stack Headroom',stack?`${stack} bytes`:'--')].join('')}
function validatePayload(payload){const issues=[];Object.entries(FIELD_MAXLEN).forEach(([key,maxLen])=>{const value=String(payload[key]??'');if(value.length>maxLen)issues.push(`${titleize(key)} exceeds ${maxLen} chars`)});if(payload.enableCloudIot){if(String(payload.iotBootstrapUrl||'').trim()&&!endpointMatches(payload.iotBootstrapUrl,'/iotDeviceBootstrap','devicebootstrap.maintelligence.app'))issues.push('Bootstrap URL must end with /iotDeviceBootstrap (recommended: https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap)');if(String(payload.iotSyncUrl||'').trim()&&!endpointMatches(payload.iotSyncUrl,'/iotDeviceSync','devicesync.maintelligence.app'))issues.push('Sync URL must end with /iotDeviceSync (recommended: https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync)')}return issues}
function parseProvisioningCode(raw){const trimmed=String(raw||'').trim();if(!trimmed)throw new Error('provisioning code is empty');if(!trimmed.includes('|')||!trimmed.includes('='))throw new Error('Unsupported provisioning code format. Use key=value|key=value');const result={};trimmed.split('|').forEach(part=>{const idx=part.indexOf('=');if(idx<=0)return;const key=part.slice(0,idx).trim();let value=part.slice(idx+1).trim();try{value=decodeURIComponent(value)}catch(_unused){}if(key)result[key]=value});if(!Object.keys(result).length)throw new Error('invalid key-value provisioning code');return result}
function provisioningFromManualFields(){const payload={organizationId:el('provisioning-organization-id').value.trim(),assetId:el('provisioning-asset-id').value.trim(),deviceKey:el('provisioning-device-key').value.trim(),bootstrapToken:el('provisioning-bootstrap-token').value.trim(),bootstrapUrl:normalizeEndpointValue(el('provisioning-bootstrap-url').value.trim(),SHORT_BOOTSTRAP_URL),syncUrl:normalizeEndpointValue(el('provisioning-sync-url').value.trim(),SHORT_SYNC_URL)};const pollRaw=Number(el('provisioning-poll-ms').value||0);if(Number.isFinite(pollRaw)&&pollRaw>0)payload.pollIntervalMs=pollRaw;return payload}
function provisioningFromConfig(){return{organizationId:String(appConfig.iotOrganizationId||''),assetId:String(appConfig.iotAssetId||''),deviceKey:String(appConfig.iotDeviceKey||''),bootstrapToken:String(appConfig.iotBootstrapToken||''),bootstrapUrl:normalizeEndpointValue(appConfig.iotBootstrapUrl,SHORT_BOOTSTRAP_URL),syncUrl:normalizeEndpointValue(appConfig.iotSyncUrl,SHORT_SYNC_URL),pollIntervalMs:Math.max(5,toNumber(appConfig.iotPollSeconds||15))*1000}}
function buildProvisioningCode(snippet){const fields=[['organizationId',snippet.organizationId],['assetId',snippet.assetId],['deviceKey',snippet.deviceKey],['bootstrapToken',snippet.bootstrapToken],['bootstrapUrl',snippet.bootstrapUrl],['syncUrl',snippet.syncUrl],['pollIntervalMs',snippet.pollIntervalMs]];return fields.filter(([,value])=>String(value??'').trim().length).map(([key,value])=>`${key}=${encodeURIComponent(String(value))}`).join('|')}
function syncProvisioningPreview(){const snippet=provisioningFromConfig();if(el('provisioning-code'))el('provisioning-code').value=buildProvisioningCode(snippet)}
function setProvisioningFields(){if(el('provisioning-organization-id'))el('provisioning-organization-id').value=String(appConfig.iotOrganizationId||'');if(el('provisioning-asset-id'))el('provisioning-asset-id').value=String(appConfig.iotAssetId||'');if(el('provisioning-device-key'))el('provisioning-device-key').value=String(appConfig.iotDeviceKey||'');if(el('provisioning-bootstrap-token'))el('provisioning-bootstrap-token').value=String(appConfig.iotBootstrapToken||'');if(el('provisioning-bootstrap-url'))el('provisioning-bootstrap-url').value=normalizeEndpointValue(appConfig.iotBootstrapUrl,SHORT_BOOTSTRAP_URL);if(el('provisioning-sync-url'))el('provisioning-sync-url').value=normalizeEndpointValue(appConfig.iotSyncUrl,SHORT_SYNC_URL);if(el('provisioning-poll-ms'))el('provisioning-poll-ms').value=String(Math.max(5,toNumber(appConfig.iotPollSeconds||15))*1000);syncProvisioningPreview()}
function applyProvisioningData(snippet){if(snippet.organizationId!=null)appConfig.iotOrganizationId=String(snippet.organizationId).trim();if(snippet.assetId!=null)appConfig.iotAssetId=String(snippet.assetId).trim();if(snippet.deviceKey!=null)appConfig.iotDeviceKey=String(snippet.deviceKey).trim();if(snippet.bootstrapToken!=null)appConfig.iotBootstrapToken=String(snippet.bootstrapToken).trim();const bootstrapSource=snippet.bootstrapUrl??snippet.bootstrapUrlPreferred??snippet.bootstrapUrlAlias??snippet.bootstrapUrlReal;if(bootstrapSource!=null)appConfig.iotBootstrapUrl=normalizeEndpointValue(String(bootstrapSource).trim(),SHORT_BOOTSTRAP_URL);else if(!String(appConfig.iotBootstrapUrl||'').trim())appConfig.iotBootstrapUrl=SHORT_BOOTSTRAP_URL;const syncSource=snippet.syncUrl??snippet.syncUrlPreferred??snippet.syncUrlAlias??snippet.syncUrlReal;if(syncSource!=null)appConfig.iotSyncUrl=normalizeEndpointValue(String(syncSource).trim(),SHORT_SYNC_URL);else if(!String(appConfig.iotSyncUrl||'').trim())appConfig.iotSyncUrl=SHORT_SYNC_URL;if(snippet.firmwareVersion!=null)appConfig.iotFirmwareVersion=String(snippet.firmwareVersion).trim();if(Array.isArray(snippet.capabilities))appConfig.iotCapabilities=snippet.capabilities.join(',');else if(typeof snippet.capabilities==='string')appConfig.iotCapabilities=snippet.capabilities.trim();if(snippet.storeTelemetry!=null)appConfig.iotStoreTelemetry=Boolean(snippet.storeTelemetry);if(snippet.pollIntervalMs!=null){const pollMs=Number(snippet.pollIntervalMs);if(Number.isFinite(pollMs)&&pollMs>0)appConfig.iotPollSeconds=Math.max(5,Math.min(3600,Math.round(pollMs/1000)))}appConfig.iotDeviceSecret='';appConfig.iotBootstrapDone=false;appConfig.iotLastDesiredVersion=-1;appConfig.enableCloudIot=true;appConfig.allowInsecureTls=true;setProvisioningFields()}
function applyProvisioningFromCode(){try{const raw=el('provisioning-code').value.trim();const snippet=parseProvisioningCode(raw);applyProvisioningData(snippet);renderConfig();renderCloudDiagnostics();flash('Provision cargada desde codigo.','ok')}catch(error){flash('Provisioning code error: '+error.message,'error')}}
function applyProvisioningFromFields(){try{const snippet=provisioningFromManualFields();if(!snippet.organizationId)throw new Error('organizationId is required');if(!snippet.assetId&&!snippet.deviceKey)throw new Error('assetId or deviceKey is required');if(!snippet.bootstrapToken)throw new Error('bootstrapToken is required');applyProvisioningData(snippet);renderConfig();renderCloudDiagnostics();flash('Provision cargada desde campos separados.','ok')}catch(error){flash('Manual provisioning error: '+error.message,'error')}}
async function loadCurrentProvisioning(){try{const current=await (await callApi('/api/v1/config')).json();appConfig={...appConfig,...current};if(!String(appConfig.iotBootstrapUrl||'').trim())appConfig.iotBootstrapUrl=SHORT_BOOTSTRAP_URL;if(!String(appConfig.iotSyncUrl||'').trim())appConfig.iotSyncUrl=SHORT_SYNC_URL;setProvisioningFields();renderCloudDiagnostics();flash('Provision actual leida del equipo.','ok')}catch(error){flash('Error leyendo provision actual: '+error.message,'error')}}
async function saveProvisioningLoaded(){try{const snippet=provisioningFromManualFields();if(!snippet.organizationId)throw new Error('organizationId is required');if(!snippet.assetId&&!snippet.deviceKey)throw new Error('assetId or deviceKey is required');if(!snippet.bootstrapToken)throw new Error('bootstrapToken is required');applyProvisioningData(snippet);await saveConfig();flash('Provision cargada y guardada.','ok')}catch(error){flash('Error guardando provision: '+error.message,'error')}}
async function refreshState(){const state=await (await callApi('/api/v1/state')).json();window.__lastState=state;renderStats(state);renderSensors(state);syncQuick(state);renderCloudDiagnostics()}
async function loadConfig(){appConfig=await (await callApi('/api/v1/config')).json();if(!String(appConfig.iotBootstrapUrl||'').trim())appConfig.iotBootstrapUrl=SHORT_BOOTSTRAP_URL;if(!String(appConfig.iotSyncUrl||'').trim())appConfig.iotSyncUrl=SHORT_SYNC_URL;renderConfig();setProvisioningFields();renderCloudDiagnostics();el('quick-mode').value=String(appConfig.workMode??0);el('quick-setpoint').value=((appConfig.setpointX10??0)/10).toFixed(1);el('quick-setpoint2').value=((appConfig.setpoint2X10??0)/10).toFixed(1)}
async function loadLogs(){el('logs').textContent=await (await callApi('/api/v1/logs')).text()}
async function saveConfig(){try{const payload=collectConfig();payload.iotBootstrapUrl=normalizeEndpointValue(payload.iotBootstrapUrl,SHORT_BOOTSTRAP_URL);payload.iotSyncUrl=normalizeEndpointValue(payload.iotSyncUrl,SHORT_SYNC_URL);const issues=validatePayload(payload);if(issues.length)throw new Error(issues.join(' | '));await callApi('/api/v1/config',{method:'POST',body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}});await Promise.all([loadConfig(),refreshState()]);flash('Configuration saved and reloaded from device.','ok')}catch(error){flash('Config error: '+error.message,'error')}}
async function applyControl(){try{const payload={workMode:toNumber(el('quick-mode').value),setpoint:toNumber(el('quick-setpoint').value),setpoint2:toNumber(el('quick-setpoint2').value),manualRelays:[...relayModel]};await callApi('/api/v1/control',{method:'POST',body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}});appConfig.workMode=payload.workMode;appConfig.setpointX10=Math.round(payload.setpoint*10);appConfig.setpoint2X10=Math.round(payload.setpoint2*10);relayDirty=false;updateMainControlVisibility();flash('Control command accepted.','ok');setTimeout(refreshState,300)}catch(error){flash('Control error: '+error.message,'error')}}
async function rebootDevice(){try{await callApi('/api/v1/reboot',{method:'POST'});flash('Reboot scheduled.','ok')}catch(error){flash('Reboot error: '+error.message,'error')}}
async function resetDevice(){if(!confirm('Reset configuration to defaults and reboot?'))return;try{await callApi('/api/v1/factory-reset',{method:'POST'});flash('Factory reset scheduled.','ok')}catch(error){flash('Factory reset error: '+error.message,'error')}}
async function boot(){renderQuickMode();renderRelayButtons();const pageSelect=el('page-select');if(pageSelect){pageSelect.value=`/app?page=${CURRENT_PAGE}`;pageSelect.onchange=()=>{const target=pageSelect.value||'/app?page=main';if(target!==`${location.pathname}${location.search}`)location.href=target}}el('quick-mode').onchange=updateMainControlVisibility;document.addEventListener('change',event=>{if(event.target&&event.target.id==='cfg-wifiUseDhcp')updateStaticIpFields();if(event.target&&event.target.id==='cfg-modbusMode'){const nextMode=toNumber(event.target.value);const draft=collectConfig();appConfig={...appConfig,...draft,modbusMode:nextMode};renderConfig()}});el('apply-control').onclick=applyControl;el('save-config').onclick=saveConfig;el('reload-config').onclick=loadConfig;el('save-quick-config').onclick=saveConfig;el('reload-quick-config').onclick=loadConfig;el('reboot').onclick=rebootDevice;el('factory-reset').onclick=resetDevice;el('apply-provisioning-code').onclick=applyProvisioningFromCode;el('apply-provisioning-fields').onclick=applyProvisioningFromFields;el('load-current-provisioning').onclick=()=>{void loadCurrentProvisioning()};el('save-provisioning').onclick=()=>{void saveProvisioningLoaded()};Promise.all([refreshState(),loadConfig(),loadLogs()]).then(()=>flash('Device synchronized.','ok')).catch(error=>flash('Startup error: '+error.message,'error'));setInterval(refreshState,2000);setInterval(loadLogs,6000)}
boot();
</script>
</body>
</html>
)rawliteral";

const char OTA_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LH Industrial V5 OTA</title>
<style>
:root{--bg:#09131a;--panel:#102630;--ink:#eef4f6;--muted:#91aab4;--line:#2d5868;--accent:#ff9340;--ok:#8ce08f;--danger:#ff7b7b}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"Trebuchet MS","Gill Sans",sans-serif;background:radial-gradient(circle at top left,#244c59 0,#08131a 42%),linear-gradient(145deg,#08131a,#15303c 58%,#21414c);color:var(--ink);overflow-x:hidden}
button,input,select,textarea{font:inherit}
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.wrap{max-width:760px;margin:0 auto;padding:22px}
h1{margin:0 0 8px;font-size:clamp(28px,4vw,40px);text-transform:uppercase;letter-spacing:.08em}
.sub{color:var(--muted);margin-bottom:18px;overflow-wrap:anywhere;word-break:break-word}
.panel{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:16px 16px 18px;margin-bottom:16px}
.field{display:grid;gap:8px}
.field input{width:100%;padding:12px;border-radius:12px;background:#08161d;color:var(--ink);border:1px solid var(--line);min-height:44px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.btn{padding:11px 16px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--accent),#ffb266);color:#20150b;font-weight:700;cursor:pointer;text-decoration:none;min-height:44px;touch-action:manipulation}
.btn.ghost{background:#0b1a21;color:var(--ink);border:1px solid var(--line)}
.status{font-size:14px;padding:12px 14px;border-radius:12px;background:#08161d;border:1px solid var(--line);overflow-wrap:anywhere;word-break:break-word}
.ok{color:var(--ok)}
.danger{color:var(--danger)}
.muted{color:var(--muted)}
@media (max-width:720px){.wrap{padding:14px}.panel{padding:14px;border-radius:14px}h1{font-size:24px;letter-spacing:.04em;line-height:1.15}.sub{font-size:14px;line-height:1.45}.actions{flex-direction:column}.actions .btn,.actions a.btn{width:100%;min-height:46px}.field input{font-size:16px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>OTA Upload</h1>
  <div class="sub">Sube un firmware `.bin` o `.bin.gz` desde el navegador. Esta ruta esta protegida por autenticacion admin.</div>
  <div class="panel">
    <div class="field">
      <label for="firmware">Firmware file</label>
      <input id="firmware" type="file" accept=".bin,.gz,.bin.gz,application/octet-stream">
    </div>
    <div class="actions">
      <button class="btn" id="upload">Upload Firmware</button>
      <a class="btn ghost" href="/app">Back to App</a>
    </div>
  </div>
  <div class="panel">
    <div class="status muted" id="status">Select a firmware file.</div>
  </div>
</div>
<script>
function el(id){return document.getElementById(id)}
function setStatus(text,kind='muted'){const node=el('status');node.textContent=text;node.className='status '+kind}
async function uploadFirmware(){const file=el('firmware').files[0];if(!file){setStatus('Select a .bin file first.','danger');return}const data=new FormData();data.append('firmware',file);setStatus('Uploading firmware... do not close this page.','muted');try{const res=await fetch('/api/v1/ota',{method:'POST',body:data,cache:'no-store'});const text=await res.text();if(!res.ok)throw new Error(text||res.statusText);setStatus(text||'OTA uploaded. Reboot scheduled.','ok')}catch(error){setStatus('OTA error: '+error.message,'danger')}}
el('upload').onclick=uploadFirmware;
</script>
</body>
</html>
)rawliteral";

const char SETUP_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LH Industrial V5 Setup</title>
<style>
:root{--bg:#09131a;--panel:#102630;--ink:#eef4f6;--muted:#91aab4;--line:#2d5868;--accent:#ff9340;--ok:#8ce08f;--danger:#ff7b7b}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"Trebuchet MS","Gill Sans",sans-serif;background:radial-gradient(circle at top left,#244c59 0,#08131a 42%),linear-gradient(145deg,#08131a,#15303c 58%,#21414c);color:var(--ink);overflow-x:hidden}
button,input,select,textarea{font:inherit}
a.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.wrap{max-width:880px;margin:0 auto;padding:22px}
h1{margin:0 0 8px;font-size:clamp(28px,4vw,40px);text-transform:uppercase;letter-spacing:.08em}
.sub{color:var(--muted);margin-bottom:18px;overflow-wrap:anywhere;word-break:break-word}
.panel{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:16px 16px 18px;margin-bottom:16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.field{display:grid;gap:6px}
.field label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.field input,.field select{width:100%;padding:10px 12px;border-radius:12px;background:#08161d;color:var(--ink);border:1px solid var(--line);min-height:44px}
.field.checkbox{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#08161d}
.field.checkbox label{margin:0;color:var(--ink)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.btn{padding:11px 16px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--accent),#ffb266);color:#20150b;font-weight:700;cursor:pointer;text-decoration:none;min-height:44px;touch-action:manipulation}
.btn.ghost{background:#0b1a21;color:var(--ink);border:1px solid var(--line)}
.status{font-size:14px;padding:12px 14px;border-radius:12px;background:#08161d;border:1px solid var(--line);overflow-wrap:anywhere;word-break:break-word}
.ok{color:var(--ok)}
.danger{color:var(--danger)}
.muted{color:var(--muted)}
@media (max-width:720px){.wrap{padding:14px}.panel{padding:14px;border-radius:14px}.grid{grid-template-columns:1fr}h1{font-size:24px;letter-spacing:.04em;line-height:1.15}.sub{font-size:14px;line-height:1.45}.actions{flex-direction:column}.actions .btn,.actions a.btn{width:100%;min-height:46px}.field input,.field select{font-size:16px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>Setup Portal</h1>
  <div class="sub">Native provisioning for V5. Configure STA WiFi, fallback AP and OTA without AutoConnect.</div>

  <div class="panel">
    <div class="grid">
      <div class="field"><label for="hostName">Host Name</label><input id="hostName"></div>
      <div class="field"><label for="adminUser">Admin User</label><input id="adminUser"></div>
      <div class="field"><label for="adminPass">Admin Password</label><input id="adminPass" type="password"></div>
      <div class="field"><label for="wifiSsid">WiFi SSID</label><input id="wifiSsid"></div>
      <div class="field"><label for="wifiPass">WiFi Password</label><input id="wifiPass" type="password"></div>
      <div class="field"><label for="wifiUseDhcp">STA IP Mode</label><select id="wifiUseDhcp"><option value="1">DHCP</option><option value="0">Static IP</option></select></div>
      <div class="field" data-static-field><label for="wifiStaticIp">Static IPv4</label><input id="wifiStaticIp" placeholder="192.168.20.120"></div>
      <div class="field" data-static-field><label for="wifiSubnetMask">Subnet Mask</label><input id="wifiSubnetMask" placeholder="255.255.255.0"></div>
      <div class="field" data-static-field><label for="wifiGateway">Gateway</label><input id="wifiGateway" placeholder="192.168.20.1"></div>
      <div class="field" data-static-field><label for="wifiDns1">Primary DNS</label><input id="wifiDns1" placeholder="8.8.8.8"></div>
      <div class="field" data-static-field><label for="wifiDns2">Secondary DNS</label><input id="wifiDns2" placeholder="8.8.4.4"></div>
      <div class="field"><label for="apPassword">Fallback AP Password</label><input id="apPassword" type="password"></div>
      <div class="field"><label for="otaPassword">OTA Password</label><input id="otaPassword" type="password"></div>
      <div class="field"><label for="wifiConnectTimeoutSec">STA Connect Timeout (sec)</label><input id="wifiConnectTimeoutSec" type="number" min="5" max="180" step="1"></div>
      <div class="field checkbox"><input id="keepApEnabled" type="checkbox"><label for="keepApEnabled">Keep AP enabled after STA connects</label></div>
      <div class="field checkbox"><input id="enableOta" type="checkbox"><label for="enableOta">Enable OTA</label></div>
    </div>
    <div class="actions">
      <button class="btn" id="save">Save Connectivity</button>
      <button class="btn ghost" id="scan" type="button">Scan WiFi</button>
      <a class="btn ghost" href="/app">Open Industrial App</a>
    </div>
  </div>

  <div class="panel">
    <div class="status" id="status">Loading...</div>
  </div>

  <div class="panel">
    <div class="sub">Nearby WiFi networks</div>
    <div class="status muted" id="scan-results">No scan yet.</div>
  </div>
</div>
<script>
function el(id){return document.getElementById(id)}
async function callApi(url,options={}){const opts={cache:'no-store',...options};if(opts.body&&!opts.headers){opts.headers={'Content-Type':'application/json'}}const res=await fetch(url,opts);if(!res.ok){throw new Error(await res.text()||res.statusText)}return res}
function setStatus(text,kind='muted'){const node=el('status');node.textContent=text;node.className='status '+kind}
function setScan(text,kind='muted'){const node=el('scan-results');node.innerHTML=text;node.className='status '+kind}
function updateIpMode(){const dhcp=el('wifiUseDhcp').value!=='0';document.querySelectorAll('[data-static-field]').forEach(node=>node.hidden=dhcp)}
function fill(data){el('hostName').value=data.hostName||'';el('adminUser').value=data.adminUser||'';el('adminPass').value=data.adminPass||'';el('wifiSsid').value=data.wifiSsid||'';el('wifiPass').value=data.wifiPass||'';el('wifiUseDhcp').value=data.wifiUseDhcp===false?'0':'1';el('wifiStaticIp').value=data.wifiStaticIp||'192.168.20.120';el('wifiSubnetMask').value=data.wifiSubnetMask||'255.255.255.0';el('wifiGateway').value=data.wifiGateway||'192.168.20.1';el('wifiDns1').value=data.wifiDns1||'8.8.8.8';el('wifiDns2').value=data.wifiDns2||'8.8.4.4';el('apPassword').value=data.apPassword||'';el('otaPassword').value=data.otaPassword||'';el('wifiConnectTimeoutSec').value=data.wifiConnectTimeoutSec||65;el('keepApEnabled').checked=Boolean(data.keepApEnabled);el('enableOta').checked=Boolean(data.enableOta);updateIpMode();const mode=data.wifiUseDhcp===false?`Static ${data.wifiStaticIp||'192.168.20.120'}`:'DHCP';const state=[data.wifiConnected?`STA connected to ${data.connectedSsid||'WiFi'}`:'STA offline',data.apModeActive?`AP active: ${data.apSsid||'setup'}`:'AP inactive',data.ipAddress?`IP ${data.ipAddress}`:'IP unavailable',`Mode ${mode}`];setStatus(state.join(' | '),data.wifiConnected?'ok':'muted')}
async function load(){const data=await (await callApi('/api/v1/network')).json();fill(data)}
async function save(){try{const payload={hostName:el('hostName').value,adminUser:el('adminUser').value,adminPass:el('adminPass').value,wifiSsid:el('wifiSsid').value,wifiPass:el('wifiPass').value,wifiUseDhcp:el('wifiUseDhcp').value!=='0',wifiStaticIp:el('wifiStaticIp').value.trim(),wifiSubnetMask:el('wifiSubnetMask').value.trim(),wifiGateway:el('wifiGateway').value.trim(),wifiDns1:el('wifiDns1').value.trim(),wifiDns2:el('wifiDns2').value.trim(),apPassword:el('apPassword').value,otaPassword:el('otaPassword').value,wifiConnectTimeoutSec:Number(el('wifiConnectTimeoutSec').value||65),keepApEnabled:el('keepApEnabled').checked,enableOta:el('enableOta').checked};await callApi('/api/v1/network',{method:'POST',body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}});setStatus('Connectivity saved. AP and STA are reloaded without forced reboot.', 'ok');setTimeout(load,1200)}catch(error){setStatus('Save error: '+error.message,'danger')}}
async function scanWifi(){try{setScan('Scanning nearby networks...','muted');const data=await (await callApi('/api/v1/wifi-scan')).json();const rows=(data.networks||[]).map(net=>`<div><button class="btn ghost" type="button" data-ssid="${String(net.ssid||'').replace(/"/g,'&quot;')}">Use</button> <b>${net.ssid||'(hidden)'}</b> RSSI ${net.rssi??'--'} dBm</div>`);setScan(rows.length?rows.join(''):'No networks found.','muted');document.querySelectorAll('[data-ssid]').forEach(btn=>btn.onclick=()=>{el('wifiSsid').value=btn.dataset.ssid;setStatus('SSID copied from scan results.','ok')})}catch(error){setScan('Scan error: '+error.message,'danger')}}
el('wifiUseDhcp').onchange=updateIpMode;el('save').onclick=save;el('scan').onclick=scanWifi;load();
</script>
</body>
</html>
)rawliteral";

void sendJsonStatus(int code, bool ok, const String& message) {
  StaticJsonDocument<256> doc;
  doc["ok"] = ok;
  doc["message"] = message;
  String out;
  serializeJson(doc, out);
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", out);
}

bool setupAccessAllowed() {
  return !hasStoredConfig() || runtimeData.apModeActive || !config().wifiSsid[0];
}

String buildNetworkJson() {
  StaticJsonDocument<1024> doc;
  doc["hostName"] = config().hostName;
  doc["adminUser"] = config().adminUser;
  doc["adminPass"] = config().adminPass;
  doc["wifiSsid"] = config().wifiSsid;
  doc["wifiPass"] = config().wifiPass;
  doc["apPassword"] = config().apPassword;
  doc["otaPassword"] = config().otaPassword;
  doc["wifiUseDhcp"] = config().wifiUseDhcp;
  doc["wifiStaticIp"] = config().wifiStaticIp;
  doc["wifiSubnetMask"] = config().wifiSubnetMask;
  doc["wifiGateway"] = config().wifiGateway;
  doc["wifiDns1"] = config().wifiDns1;
  doc["wifiDns2"] = config().wifiDns2;
  doc["wifiConnectTimeoutSec"] = config().wifiConnectTimeoutSec;
  doc["keepApEnabled"] = config().keepApEnabled;
  doc["enableOta"] = config().enableOta;
  doc["wifiConnected"] = runtimeData.wifiConnected;
  doc["apModeActive"] = runtimeData.apModeActive;
  doc["ipAddress"] = runtimeData.ipAddress;
  doc["connectedSsid"] = runtimeData.connectedSsid;
  doc["apSsid"] = runtimeData.apSsid;
  String out;
  serializeJson(doc, out);
  return out;
}

String buildWifiScanJson() {
  StaticJsonDocument<2048> doc;
  JsonArray networks = doc.createNestedArray("networks");
  const int found = WiFi.scanNetworks();
  for (int index = 0; index < found && index < 20; ++index) {
    JsonObject row = networks.createNestedObject();
    row["ssid"] = WiFi.SSID(index);
    row["rssi"] = WiFi.RSSI(index);
  }
  WiFi.scanDelete();
  String out;
  serializeJson(doc, out);
  return out;
}

class StringPrint : public Print {
 public:
  size_t write(uint8_t ch) override {
    buffer += static_cast<char>(ch);
    return 1;
  }

  size_t write(const uint8_t* data, size_t size) override {
    if (!data || !size) return 0;
    for (size_t index = 0; index < size; ++index) {
      buffer += static_cast<char>(data[index]);
    }
    return size;
  }

  String buffer;
};

#if defined(ARDUINO_ARCH_ESP32)
size_t countOtaAppPartitions() {
  size_t count = 0;
  for (esp_partition_iterator_t it = esp_partition_find(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, nullptr); it != nullptr; it = esp_partition_next(it)) {
    const esp_partition_t* partition = esp_partition_get(it);
    if (!partition) continue;
    if (partition->subtype >= ESP_PARTITION_SUBTYPE_APP_OTA_0 && partition->subtype < ESP_PARTITION_SUBTYPE_APP_OTA_MAX) ++count;
  }
  return count;
}

String httpOtaPreflightError(size_t firmwareSize) {
  const size_t otaPartitionCount = countOtaAppPartitions();
  if (otaPartitionCount < 2) {
    return "OTA unavailable: no free OTA slot. Flash by USB.";
  }
  const esp_partition_t* running = esp_ota_get_running_partition();
  const esp_partition_t* target = esp_ota_get_next_update_partition(nullptr);
  if (!target || (running && target->address == running->address)) {
    return "OTA unavailable: target slot error. Flash by USB.";
  }
  if (firmwareSize && firmwareSize > target->size) {
    String message = "OTA image too large for slot: ";
    message += static_cast<unsigned long>(firmwareSize);
    message += " > ";
    message += static_cast<unsigned long>(target->size);
    message += " bytes.";
    return message;
  }
  return String();
}
#else
String httpOtaPreflightError(size_t firmwareSize) {
  (void)firmwareSize;
  return String();
}
#endif

void clearHttpOtaState() {
  gHttpOtaStarted = false;
  gHttpOtaErrorMessage = String();
}

String otaUploadResultText() {
  if (gHttpOtaErrorMessage.length()) return gHttpOtaErrorMessage;
  StringPrint errors;
  Update.printError(errors);
  String message = errors.buffer;
  message.trim();
  if (!message.length()) message = "OTA upload failed";
  return message;
}

}  // namespace

void registerWebRoutes() {
  server.on("/", HTTP_GET, []() {
    server.sendHeader("Cache-Control", "no-store");
    server.sendHeader("Location", setupAccessAllowed() ? "/setup" : "/app");
    server.send(302, "text/plain", "redirect");
  });

  server.on("/setup", HTTP_GET, []() {
    if (!setupAccessAllowed() && !ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html", SETUP_HTML);
  });

  server.on("/app", HTTP_GET, []() {
    if (!ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html", APP_HTML);
  });

  server.on("/ota", HTTP_GET, []() {
    if (!ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html", OTA_HTML);
  });

  server.on("/api/v1/network", HTTP_GET, []() {
    if (!setupAccessAllowed() && !ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", buildNetworkJson());
  });

  server.on("/api/v1/network", HTTP_POST, []() {
    if (!setupAccessAllowed() && !ensureAdminAuthenticated()) return;
    String error;
    if (updateConfigFromJson(server.arg("plain"), error)) sendJsonStatus(200, true, "network saved");
    else sendJsonStatus(400, false, error);
  });

  server.on("/api/v1/wifi-scan", HTTP_GET, []() {
    if (!setupAccessAllowed() && !ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", buildWifiScanJson());
  });

  server.on("/api/v1/ota", HTTP_POST, []() {
    if (!ensureAdminAuthenticated()) return;
    const bool success = gHttpOtaStarted && !Update.hasError() && !gHttpOtaErrorMessage.length();
    const String message = success ? String("OTA uploaded successfully. Reboot scheduled.") : otaUploadResultText();
    server.sendHeader("Cache-Control", "no-store");
    server.send(success ? 200 : 500, "text/plain", message);
    if (success) {
      addLog("HTTP OTA upload completed successfully");
      scheduleRestart("http ota", 1500U);
    } else {
      addLog("HTTP OTA upload failed: %s", message.c_str());
    }
    clearHttpOtaState();
  }, []() {
    HTTPUpload& upload = server.upload();
    switch (upload.status) {
      case UPLOAD_FILE_START:
        clearHttpOtaState();
        addLog("HTTP OTA upload started: %s", upload.filename.c_str());
        gHttpOtaErrorMessage = httpOtaPreflightError(upload.totalSize);
        if (gHttpOtaErrorMessage.length()) {
          addLog("HTTP OTA upload rejected: %s", gHttpOtaErrorMessage.c_str());
          break;
        }
        if (!Update.begin(upload.totalSize ? upload.totalSize : UPDATE_SIZE_UNKNOWN, U_FLASH)) {
          Update.printError(Serial);
          gHttpOtaErrorMessage = otaUploadResultText();
          addLog("HTTP OTA begin failed: %s", gHttpOtaErrorMessage.c_str());
        } else {
          gHttpOtaStarted = true;
        }
        break;
      case UPLOAD_FILE_WRITE:
        if (!gHttpOtaStarted) break;
        if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
          Update.printError(Serial);
          gHttpOtaErrorMessage = otaUploadResultText();
          addLog("HTTP OTA write failed: %s", gHttpOtaErrorMessage.c_str());
        }
        break;
      case UPLOAD_FILE_END:
        if (!gHttpOtaStarted) break;
        if (!Update.end(true)) {
          Update.printError(Serial);
          gHttpOtaErrorMessage = otaUploadResultText();
          addLog("HTTP OTA end failed: %s", gHttpOtaErrorMessage.c_str());
        }
        break;
      case UPLOAD_FILE_ABORTED:
        if (gHttpOtaStarted) Update.abort();
        gHttpOtaErrorMessage = "OTA upload aborted";
        addLog("HTTP OTA upload aborted");
        break;
      default:
        break;
    }
    yield();
  });

  server.on("/api/v1/state", HTTP_GET, []() {
    if (!ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", buildStateJson());
  });

  server.on("/api/v1/logs", HTTP_GET, []() {
    if (!ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "text/plain", buildLogsText());
  });

  server.on("/api/v1/config", HTTP_GET, []() {
    if (!ensureAdminAuthenticated()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", buildConfigJson());
  });

  server.on("/api/v1/config", HTTP_POST, []() {
    if (!ensureAdminAuthenticated()) return;
    String error;
    if (updateConfigFromJson(server.arg("plain"), error)) sendJsonStatus(200, true, "configuration saved");
    else sendJsonStatus(400, false, error);
  });

  server.on("/api/v1/control", HTTP_POST, []() {
    if (!ensureAdminAuthenticated()) return;
    String error;
    if (handleControlJson(server.arg("plain"), error)) sendJsonStatus(200, true, "control applied");
    else sendJsonStatus(400, false, error);
  });

  server.on("/api/v1/reboot", HTTP_POST, []() {
    if (!ensureAdminAuthenticated()) return;
    scheduleRestart("api reboot", 1000U);
    sendJsonStatus(200, true, "reboot scheduled");
  });

  server.on("/api/v1/factory-reset", HTTP_POST, []() {
    if (!ensureAdminAuthenticated()) return;
    factoryResetAndRestart();
    sendJsonStatus(200, true, "factory reset scheduled");
  });

  server.onNotFound([]() {
    server.sendHeader("Location", setupAccessAllowed() ? "/setup" : "/app");
    server.send(302, "text/plain", "redirect");
  });
}

}  // namespace industrial_v2







