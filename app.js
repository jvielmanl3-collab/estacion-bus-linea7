const TARIFA = 500; // Dinero en centavos para evitar errores decimales.
const $ = id => document.getElementById(id);
let seleccionada = null;
let credencial = '';
let datos = {tarjetas: []};
let revision = 0;
let ocupado = false;
const dinero = n => 'Q' + (n / 100).toFixed(2);
function aviso(texto, error = false) {
    $('aviso').textContent = texto;
    $('aviso').className = error ? 'error' : '';
    $('estadoAdmin').textContent = texto;
}
function actual() { return seleccionada; }
function exigir() {
    if (!seleccionada) throw Error('Primero compra o consulta una tarjeta.');
    return seleccionada;
}
function celda(fila, texto) { const td = document.createElement('td'); td.textContent = texto; fila.appendChild(td); }
function dibujar() {
  const t = actual();
  $('numero').textContent = t ? t.id : 'Sin tarjeta seleccionada';
  $('titular').textContent = 'Titular: ' + (t?.nombre || 'sin registrar');
  $('documento').textContent = 'Documento: ' + (t?.documento || 'sin registrar');
  $('correo').textContent = 'Correo: ' + (t?.email || 'sin registrar');
  $('saldo').textContent = dinero(t?.saldo || 0);
  $('nombre').value = t?.nombre || ''; $('identificacion').value = t?.documento || ''; $('email').value = t?.email || '';
  $('movimientos').replaceChildren();
  for (const m of [...(t?.historial || [])].reverse()) {
    const tr = document.createElement('tr');
    [new Date(m.fecha).toLocaleString('es-GT'), m.tipo, m.detalle, dinero(m.importe), dinero(m.saldo)].forEach(v => celda(tr,v));
    $('movimientos').appendChild(tr);
  }
  if (!t?.historial.length) { const tr = document.createElement('tr'); celda(tr,'Selecciona una tarjeta para ver su historial.'); $('movimientos').appendChild(tr); }
  $('viajeActual').textContent = t?.viaje ? 'Viaje activo · Origen: ' + PARADAS[t.viaje.origen] : 'No hay un viaje activo.';
  $('destino').replaceChildren();
  PARADAS.forEach((nombre,i) => { if(t?.viaje && i !== t.viaje.origen) $('destino').add(new Option(nombre,String(i))); });
  $('parada').querySelector('button').disabled = !t?.viaje || !$('destino').options.length;
  $('acceso').hidden = Boolean(credencial); $('panelAdmin').hidden = !credencial;
  $('listaAdmin').replaceChildren();
  if (credencial) {
    let viajes = 0;
    for (const tarjeta of datos.tarjetas) {
      const cantidad = tarjeta.historial.filter(m=>m.tipo==='Abordaje').length; viajes += cantidad;
      const tr = document.createElement('tr'); [tarjeta.id,tarjeta.nombre || 'Sin registrar',dinero(tarjeta.saldo),cantidad].forEach(v=>celda(tr,v)); $('listaAdmin').appendChild(tr);
    }
    $('resumen').textContent = `${datos.tarjetas.length} tarjetas · ${viajes} abordajes · ${dinero(viajes*TARIFA)} en pasajes simulados`;
  }
}

async function api(accion, cuerpo = {}, autorizacion = '') {
    if (!API_URL) throw Error('Falta colocar la dirección del servidor en config.js.');
    const headers = {'Content-Type': 'application/json'};
    if (autorizacion) headers.Authorization = 'Basic ' + autorizacion;
    let respuesta;
    try {
        respuesta = await fetch(API_URL.replace(/\/$/, '') + '/' + accion, {
            method: 'POST', headers, body: JSON.stringify(cuerpo), cache: 'no-store'
        });
    } catch {
        throw Error('Sin conexión con el servidor. Consulta la tarjeta antes de repetir una operación.');
    }
    const contenido = await respuesta.json();
    if (!respuesta.ok) throw Error(contenido.error || 'Error al contactar el servidor.');
    return contenido;
}
function escuchar(id, evento, tarea) {
    $(id).addEventListener(evento, async e => {
        e.preventDefault();
        if (ocupado) return;
        ocupado = true;
        try { await tarea(); }
        catch (error) { aviso(error.message, true); }
        finally { ocupado = false; }
    });
}
function mostrarLista(lista) {
    datos = lista;
    revision = lista.revision;
    if (seleccionada) seleccionada = lista.tarjetas.find(t => t.id === seleccionada.id) || null;
    dibujar();
}
function descargarJSON(copia) {
    const archivo = new Blob([JSON.stringify(copia, null, 2)], {type: 'application/json'});
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = 'linea7-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}
async function operarTarjeta(accion, campos, mensaje) {
    seleccionada = await api(accion, campos);
    $('codigo').value = seleccionada.id;
    if (credencial) {
        // La revisión del último listado se conserva hasta actualizarlo.
        const otras = datos.tarjetas.filter(t => t.id !== seleccionada.id);
        datos.tarjetas = [...otras, seleccionada];
    }
    dibujar();
    aviso(mensaje);
}
escuchar('comprar', 'click', () => operarTarjeta('comprar', {}, 'Tarjeta creada. Copia su código para volver a usarla.'));
escuchar('consulta', 'submit', () => operarTarjeta('consultar',
    {id: $('codigo').value.trim().toUpperCase()}, 'Tarjeta consultada sin cobro.'));
escuchar('registro', 'submit', () => operarTarjeta('registro', {
    id: exigir().id, nombre: $('nombre').value.trim(), documento: $('identificacion').value.trim(),
    email: $('email').value.trim()
}, 'Datos personales guardados.'));
escuchar('recarga', 'submit', async () => {
    if (!/^\d+(\.\d{1,2})?$/.test($('monto').value)) throw Error('Usa hasta dos decimales.');
    await operarTarjeta('recarga', {id: exigir().id, monto: Math.round(Number($('monto').value) * 100)}, 'Recarga realizada.');
    $('monto').value = '';
});
escuchar('abordaje', 'submit', () => operarTarjeta('abordaje',
    {id: exigir().id, origen: Number($('origen').value)}, 'Abordaje registrado. Se descontaron Q5.00.'));
escuchar('parada', 'submit', () => operarTarjeta('parada',
    {id: exigir().id, destino: Number($('destino').value)}, 'Viaje finalizado sin cobro adicional.'));
escuchar('login', 'submit', async () => {
    const usuario = $('usuario').value.trim();
    const clave = $('clave').value;
    $('clave').value = '';
    if (usuario === 'golden' && clave === 'apple') {
        $('gifEasterEgg').src = $('gifEasterEgg').dataset.src;
        $('easterEgg').showModal();
        return;
    }
    const intento = btoa(usuario + ':' + clave);
    const lista = await api('admin', {}, intento);
    credencial = intento;
    mostrarLista(lista);
    aviso('Sesión de administrador iniciada.');
});
$('easterEgg').addEventListener('close', () => $('gifEasterEgg').removeAttribute('src'));
escuchar('salir', 'click', () => {
    credencial = '';
    datos = {tarjetas: []};
    seleccionada = null;
    $('codigo').value = '';
    $('archivo').value = '';
    dibujar();
    aviso('Sesión cerrada.');
});
escuchar('actualizarAdmin', 'click', async () => {
    mostrarLista(await api('admin', {}, credencial));
    aviso('Lista actualizada.');
});
escuchar('guardarCopia', 'click', async () => {
    const lista = await api('admin', {}, credencial);
    mostrarLista(lista);
    descargarJSON(lista);
    aviso('Respaldo completo descargado.');
});
escuchar('restaurar', 'submit', async () => {
    const archivo = $('archivo').files[0];
    let copia;
    try { copia = JSON.parse(await archivo.text()); }
    catch { throw Error('No se pudo leer el archivo JSON.'); }
    if (!Array.isArray(copia?.tarjetas)) throw Error('Selecciona un respaldo de tarjetas.');
    if (!confirm('¿Reemplazar las ' + datos.tarjetas.length + ' tarjetas de la estación por las ' +
        copia.tarjetas.length + ' del respaldo? Este cambio afecta a todos los dispositivos.')) return;
    const resultado = await api('importar', {copia, revision}, credencial);
    $('archivo').value = '';
    mostrarLista(await api('admin', {}, credencial));
    aviso('Importación completada. Tarjetas restauradas: ' + resultado.total);
});
$('exportar').addEventListener('click',()=>{try{const t=exigir(); const escapar=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const filas=[['Fecha','Movimiento','Detalle','Importe Q','Saldo Q'],...t.historial.map(m=>[new Date(m.fecha).toLocaleString('es-GT'),m.tipo,m.detalle,(m.importe/100).toFixed(2),(m.saldo/100).toFixed(2)])];const blob=new Blob(['\ufeff'+filas.map(f=>f.map(escapar).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='historial-'+t.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);aviso('Historial generado. Revisa tus descargas.');}catch(e){aviso(e.message,true);}});
PARADAS.forEach((p,i)=>{const li=document.createElement('li'),b=document.createElement('b');b.textContent=String(i+1).padStart(2,'0');li.append(b,document.createTextNode(p));$('circuito').appendChild(li);$('origen').add(new Option(p,String(i)));});
dibujar();
