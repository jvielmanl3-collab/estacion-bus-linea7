import { PARADAS } from './paradas.mjs';

const cabeceras = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store'
};
function respuesta(datos, status = 200) {
    return Response.json(datos, {status, headers: cabeceras});
}
class ErrorCliente extends Error {}
function verificar(condicion, mensaje) {
    if (!condicion) throw new ErrorCliente(mensaje);
}
function entero(n, min, max) {
    return Number.isSafeInteger(n) && n >= min && n <= max;
}
function texto(s, max) {
    return typeof s === 'string' && s.length <= max;
}
function indice(n) { return entero(n, 0, PARADAS.length - 1); }
function registrar(t, tipo, detalle, importe = 0) {
    t.historial.push({fecha: new Date().toISOString(), tipo, detalle, importe, saldo: t.saldo});
}
function perfil(nombre, documento, email) {
    return texto(nombre, 80) && nombre.trim().length >= 3 &&
        texto(documento, 25) && documento.trim().length >= 4 &&
        texto(email, 100) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validarRespaldo(d) {
    verificar(d?.version === 1 && d.recorrido === 'linea7' && Array.isArray(d.tarjetas),
        'Selecciona un respaldo de tarjetas de la Línea 7.');
    const ids = new Set();
    for (const t of d.tarjetas) {
        verificar(t && typeof t.id === 'string' && /^URB-(?:[A-F0-9]{32}|[0-9]{4,12})$/.test(t.id) &&
            !ids.has(t.id) && entero(t.saldo, 0, 1000000) &&
            (perfil(t.nombre, t.documento, t.email) || [t.nombre, t.documento, t.email].every(x => x === '')) &&
            (t.viaje === null || indice(t.viaje?.origen)) && Array.isArray(t.historial),
            'Hay una tarjeta inválida o un código repetido.');
        ids.add(t.id);
        verificar(t.historial.every(m => m && texto(m.tipo, 80) && texto(m.detalle, 300) &&
            texto(m.fecha, 50) && Number.isFinite(Date.parse(m.fecha)) &&
            entero(m.importe, -1000000, 1000000) && entero(m.saldo, 0, 1000000)),
            'El historial del respaldo contiene datos inválidos.');
    }
}
export class Estacion {
    constructor(ctx, env) {
        this.env = env;
        this.storage = ctx.storage;
        this.sql = ctx.storage.sql;
        this.sql.exec('CREATE TABLE IF NOT EXISTS tarjetas (id TEXT PRIMARY KEY, ficha TEXT NOT NULL)');
        this.sql.exec('CREATE TABLE IF NOT EXISTS control (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
        this.sql.exec('INSERT OR IGNORE INTO control VALUES (1, 0)');
    }
    revision() {
        return this.sql.exec('SELECT revision FROM control WHERE id=1').one().revision;
    }
    async fetch(req) {
        const accion = new URL(req.url).pathname.slice(1);
        if (['admin', 'importar'].includes(accion)) {
            const clave = this.env.ADMIN_PASSWORD;
            if (!clave || req.headers.get('Authorization') !== 'Basic ' + btoa('admin:' + clave)) {
                return respuesta({error: 'Usuario o contraseña incorrectos.'}, 401);
            }
        }
        try {
            const cuerpo = await req.json().catch(() => null);
            verificar(cuerpo && typeof cuerpo === 'object', 'Solicitud inválida.');
            const resultado = this.storage.transactionSync(() => this.operar(accion, cuerpo));
            return respuesta(resultado);
        } catch (e) {
            return respuesta({error: e instanceof ErrorCliente ? e.message : 'No se pudo completar la operación.'},
                e instanceof ErrorCliente ? 400 : 500);
        }
    }
    operar(accion, p) {
        if (accion === 'admin') {
            return {version: 1, recorrido: 'linea7', revision: this.revision(),
                tarjetas: this.sql.exec('SELECT ficha FROM tarjetas ORDER BY rowid').toArray().map(r => JSON.parse(r.ficha))};
        }
        if (accion === 'importar') {
            validarRespaldo(p.copia);
            verificar(p.revision === this.revision(), 'Los datos cambiaron. Actualiza la lista y vuelve a revisar la importación.');
            this.sql.exec('DELETE FROM tarjetas');
            for (const t of p.copia.tarjetas) this.guardar(t);
            this.incrementar();
            return {total: p.copia.tarjetas.length};
        }
        let t;
        if (accion === 'comprar') {
            const id = 'URB-' + crypto.randomUUID().replaceAll('-', '').toUpperCase();
            t = {id, nombre: '', documento: '', email: '', saldo: 0, viaje: null, historial: []};
            registrar(t, 'Compra', 'Tarjeta vacía creada');
        } else {
            verificar(typeof p.id === 'string', 'Falta el código de tarjeta.');
            const fila = this.sql.exec('SELECT ficha FROM tarjetas WHERE id=?', p.id).toArray()[0];
            verificar(fila, 'No se encontró esa tarjeta.');
            t = JSON.parse(fila.ficha);
            if (accion === 'consultar') return t;
            if (accion === 'registro') {
                verificar(perfil(p.nombre, p.documento, p.email), 'Revisa los datos personales.');
                Object.assign(t, {nombre: p.nombre, documento: p.documento, email: p.email});
                registrar(t, 'Registro', 'Datos personales guardados');
            } else if (accion === 'recarga') {
                verificar(entero(p.monto, 100, 100000) && t.saldo + p.monto <= 1000000,
                    'Recarga entre Q1 y Q1000. El saldo máximo es Q10000.');
                t.saldo += p.monto;
                registrar(t, 'Recarga', 'Carga de saldo simulada', p.monto);
            } else if (accion === 'abordaje') {
                verificar(t.nombre && !t.viaje && t.saldo >= 500 && indice(p.origen),
                    'Para abordar necesitas registro, Q5 y haber finalizado el viaje anterior.');
                t.saldo -= 500;
                t.viaje = {origen: p.origen};
                registrar(t, 'Abordaje', PARADAS[p.origen], -500);
            } else if (accion === 'parada') {
                verificar(t.viaje && indice(p.destino) && t.viaje.origen !== p.destino,
                    'Selecciona un destino distinto del origen de tu viaje activo.');
                registrar(t, 'Parada', PARADAS[p.destino]);
                registrar(t, 'Fin de viaje', PARADAS[t.viaje.origen] + ' → ' + PARADAS[p.destino]);
                t.viaje = null;
            } else throw new ErrorCliente('Operación desconocida.');
        }
        this.guardar(t);
        this.incrementar();
        return t;
    }
    incrementar() {
        this.sql.exec('UPDATE control SET revision=revision+1 WHERE id=1');
    }
    guardar(t) {
        this.sql.exec('INSERT OR REPLACE INTO tarjetas (id,ficha) VALUES (?,?)', t.id, JSON.stringify(t));
    }
}
export default {
    async fetch(req, env) {
        if (req.method === 'OPTIONS') return new Response(null, {headers: cabeceras});
        if (req.method !== 'POST') return respuesta({error: 'Usa la página de la estación.'}, 405);
        return env.ESTACION.get(env.ESTACION.idFromName('linea7')).fetch(req);
    }
};
