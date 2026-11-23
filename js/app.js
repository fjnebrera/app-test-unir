/**
 * =====================================================================
 * 1. CAPA DE DATOS (ASIGNATURAS Y PREGUNTAS)
 * =====================================================================
 * Las asignaturas se declaran en 'data/asignaturas.json' y cada una
 * apunta a su propio banco de preguntas dentro de 'data/'.
 * La app debe servirse por HTTP (Netlify o un servidor local):
 * abrir index.html con file:// impide que fetch() lea los JSON.
 * =====================================================================
 */
const RUTA_MANIFIESTO = './data/asignaturas.json';

const CargadorAsignaturas = {
    async cargarJSON(url, descripcion) {
        const respuesta = await fetch(url, { cache: 'no-cache' });
        if (!respuesta.ok) {
            throw new Error(`No se pudo cargar ${descripcion} (HTTP ${respuesta.status})`);
        }

        try {
            return await respuesta.json();
        } catch (error) {
            throw new Error(`El archivo ${descripcion} no contiene JSON válido`);
        }
    },

    async cargarManifiesto() {
        const datos = await this.cargarJSON(RUTA_MANIFIESTO, 'data/asignaturas.json');

        const valido = Array.isArray(datos) && datos.length > 0 && datos.every(a =>
            a &&
            typeof a.id === 'string' && a.id.trim() !== '' &&
            typeof a.nombre === 'string' && a.nombre.trim() !== '' &&
            typeof a.archivo === 'string' &&
            a.archivo.toLowerCase().endsWith('.json') &&
            !a.archivo.includes('/') &&
            !a.archivo.includes('\\')
        );

        if (!valido) {
            throw new Error('El formato de data/asignaturas.json no es válido');
        }

        const ids = new Set(datos.map(a => a.id));
        if (ids.size !== datos.length) {
            throw new Error('Hay asignaturas con un id duplicado');
        }

        return datos;
    },

    async cargarPreguntas(archivo) {
        const datos = await this.cargarJSON(`./data/${archivo}`, `data/${archivo}`);

        const valido = Array.isArray(datos) && datos.length > 0 && datos.every(p =>
            p && typeof p.enunciado === 'string' &&
            Array.isArray(p.opciones) && p.opciones.length >= 2 &&
            p.opciones.every(o =>
                o && typeof o.texto === 'string' && typeof o.correcta === 'boolean'
            )
        );

        if (!valido) {
            throw new Error(`El formato de data/${archivo} no es válido`);
        }

        return datos;
    }
};

function mostrarErrorCarga(mensaje) {
    const estado = document.getElementById('estado-carga');
    const ayuda = location.protocol === 'file:'
        ? 'Abre la app desde un servidor HTTP (por ejemplo: python3 -m http.server 8000).'
        : 'Comprueba que los archivos de data/ existen y que el sitio se sirve por HTTP.';
    estado.classList.remove('hidden');
    estado.classList.add('error-carga');
    estado.textContent = `No se pudieron cargar los datos: ${mensaje}. ${ayuda}`;
}

// Limpieza de citas automáticas
const limpiarCitas = (texto) => {
    return texto.replace(/\+\]/g, '').trim();
};

/**
 * =====================================================================
 * 2. CASOS DE USO (Aplicación)
 * =====================================================================
 * El motor inyecta entropía (aleatoriedad) sin mutar la base original.
 * =====================================================================
 */
const MotorTest = {

    // Función de barajado puro (Fisher-Yates) que devuelve un nuevo array
    barajarArray: (array) => {
        const arrCopia = [...array];
        for (let i = arrCopia.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arrCopia[i], arrCopia[j]] = [arrCopia[j], arrCopia[i]];
        }
        return arrCopia;
    },

    // Agrupa en bloques de 12 (el orden inicial se mantiene para los tests)
    generarBaterias: (preguntas, tamano) => {
        const baterias = [];
        for (let i = 0; i < preguntas.length; i += tamano) {
            let chunk = preguntas.slice(i, i + tamano);
            if (chunk.length < tamano && chunk.length > 0) {
                const faltantes = tamano - chunk.length;
                chunk = chunk.concat(preguntas.slice(0, faltantes));
            }
            baterias.push(chunk);
        }
        return baterias;
    },

    // Aplica aleatoriedad a un bloque específico en el momento de jugarlo
    prepararTestAleatorio: function(bloquePreguntas) {
        // Hacemos una copia profunda (clon) para no tocar la batería original
        const bloqueCopia = JSON.parse(JSON.stringify(bloquePreguntas));

        // Barajamos el orden de las preguntas
        const bloqueBarajado = this.barajarArray(bloqueCopia);

        // Barajamos el orden de las opciones de cada pregunta
        bloqueBarajado.forEach(preg => {
            preg.opciones = this.barajarArray(preg.opciones);
        });

        return bloqueBarajado;
    },

    calcularPuntuacion: (testActual, respuestasUsuario) => {
        let puntuacion = 0;
        let aciertos = 0;
        let fallos = 0;

        testActual.forEach((pregunta, index) => {
            const seleccion = respuestasUsuario[index];
            if (seleccion !== undefined) {
                if (pregunta.opciones[seleccion].correcta) {
                    puntuacion += 0.417;
                    aciertos++;
                } else {
                    puntuacion -= 0.104;
                    fallos++;
                }
            }
        });

        return {
            notaFinal: puntuacion.toFixed(3),
            aciertos,
            fallos,
            enBlanco: testActual.length - (aciertos + fallos)
        };
    }
};

/**
 * =====================================================================
 * 3. ADAPTADORES (Infraestructura / DOM)
 * =====================================================================
 */
const AdaptadorDOM = {
    asignaturas: [],
    asignaturaActual: null,
    bateriasEstáticas: [], // Las agrupaciones de 12 de la asignatura actual
    testActivo: [],        // El bloque clonado y barajado que estamos haciendo AHORA
    respuestasActuales: {},
    cargandoAsignatura: false,

    iniciar: function(asignaturas) {
        this.asignaturas = asignaturas;
        this.pintarSelector();
        this.conectarEventos();
        this.mostrarSeleccion();
    },

    conectarEventos: function() {
        document.getElementById('btn-cargar-asignatura').addEventListener('click', () => this.cargarAsignaturaSeleccionada());
        document.getElementById('btn-volver-asignaturas').addEventListener('click', () => this.volverASeleccion());
        document.getElementById('btn-entregar').addEventListener('click', () => this.entregarTest());
        document.getElementById('btn-volver-menu').addEventListener('click', () => this.volverAlMenu());
    },

    pintarSelector: function() {
        const selector = document.getElementById('selector-asignatura');
        selector.innerHTML = '';

        this.asignaturas.forEach(asignatura => {
            const opcion = document.createElement('option');
            opcion.value = asignatura.id;
            opcion.textContent = asignatura.nombre;
            selector.appendChild(opcion);
        });

        selector.value = this.asignaturas[0].id;
        selector.disabled = false;
        document.getElementById('btn-cargar-asignatura').disabled = false;
        this.ocultarCargando();
    },

    actualizarTitulo: function(nombre) {
        document.getElementById('titulo-asignatura').textContent = nombre;
        document.title = `${nombre} - Batería de Test`;
    },

    restablecerTitulo: function() {
        document.getElementById('titulo-asignatura').textContent = 'Batería de Test';
        document.title = 'Batería de Test';
    },

    mostrarSeleccion: function() {
        this.asignaturaActual = null;
        this.bateriasEstáticas = [];
        this.testActivo = [];
        this.respuestasActuales = {};

        document.getElementById('contenedor-botones-test').innerHTML = '';
        document.getElementById('vista-menu').classList.add('hidden');
        document.getElementById('vista-test').classList.add('hidden');
        document.getElementById('vista-seleccion').classList.remove('hidden');
        document.getElementById('resultado-box').classList.add('hidden');
        this.restablecerTitulo();
        this.ocultarCargando();
    },

    volverASeleccion: function() {
        this.mostrarSeleccion();
        document.getElementById('selector-asignatura').disabled = false;
        document.getElementById('btn-cargar-asignatura').disabled = false;
        window.scrollTo(0, 0);
    },

    mostrarCargando: function(texto) {
        const estado = document.getElementById('estado-carga');
        estado.classList.remove('hidden', 'error-carga');
        estado.textContent = texto;
    },

    ocultarCargando: function() {
        const estado = document.getElementById('estado-carga');
        estado.classList.add('hidden');
        estado.classList.remove('error-carga');
        estado.textContent = '';
    },

    cargarAsignaturaSeleccionada: async function() {
        if (this.cargandoAsignatura) {
            return;
        }

        const selector = document.getElementById('selector-asignatura');
        const botonCargar = document.getElementById('btn-cargar-asignatura');
        const asignatura = this.asignaturas.find(a => a.id === selector.value);

        if (!asignatura) {
            mostrarErrorCarga('La asignatura seleccionada no existe');
            return;
        }

        this.cargandoAsignatura = true;
        selector.disabled = true;
        botonCargar.disabled = true;
        document.getElementById('vista-menu').classList.add('hidden');
        document.getElementById('vista-test').classList.add('hidden');
        document.getElementById('resultado-box').classList.add('hidden');
        this.mostrarCargando(`Cargando ${asignatura.nombre}…`);

        try {
            const preguntas = await CargadorAsignaturas.cargarPreguntas(asignatura.archivo);
            this.asignaturaActual = asignatura;
            this.bateriasEstáticas = MotorTest.generarBaterias(preguntas, 12);
            this.testActivo = [];
            this.respuestasActuales = {};
            this.actualizarTitulo(asignatura.nombre);
            this.pintarMenu();
        } catch (error) {
            mostrarErrorCarga(error.message);
        } finally {
            this.cargandoAsignatura = false;
            selector.disabled = false;
            botonCargar.disabled = false;
        }
    },

    pintarMenu: function() {
        document.getElementById('vista-seleccion').classList.add('hidden');
        document.getElementById('vista-test').classList.add('hidden');
        document.getElementById('vista-menu').classList.remove('hidden');
        document.getElementById('resultado-box').classList.add('hidden');
        this.ocultarCargando();

        const contenedor = document.getElementById('contenedor-botones-test');
        contenedor.innerHTML = '';

        this.bateriasEstáticas.forEach((_, index) => {
            const btn = document.createElement('button');
            btn.className = 'test-btn';
            btn.innerText = `Test ${index + 1}`;
            btn.onclick = () => this.cargarTest(index);
            contenedor.appendChild(btn);
        });
    },

    cargarTest: function(indexTest) {
        this.respuestasActuales = {};

        // Clonamos y barajamos el test para esta sesión
        this.testActivo = MotorTest.prepararTestAleatorio(this.bateriasEstáticas[indexTest]);

        document.getElementById('vista-menu').classList.add('hidden');
        document.getElementById('vista-test').classList.remove('hidden');
        document.getElementById('resultado-box').classList.add('hidden');
        document.getElementById('titulo-test').innerText = `Test ${indexTest + 1}`;
        document.getElementById('btn-entregar').disabled = false;

        const contenedorPreguntas = document.getElementById('contenedor-preguntas');
        contenedorPreguntas.innerHTML = '';

        this.testActivo.forEach((preg, idxPregunta) => {
            const div = document.createElement('div');
            div.className = 'pregunta-card';

            const h3 = document.createElement('h3');
            // Limpiamos la pregunta y la insertamos
            h3.innerText = `${idxPregunta + 1}. ${limpiarCitas(preg.enunciado).replace(/^\d+\.\s*/, '')}`;
            div.appendChild(h3);

            preg.opciones.forEach((opcion, idxOpcion) => {
                const label = document.createElement('label');
                label.className = 'opcion-label';
                label.id = `label_preg_${idxPregunta}_opc_${idxOpcion}`;

                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `pregunta_${idxPregunta}`;
                input.value = idxOpcion;
                input.id = `input_preg_${idxPregunta}_opc_${idxOpcion}`;

                input.onchange = (e) => {
                    this.respuestasActuales[idxPregunta] = parseInt(e.target.value);
                };

                label.appendChild(input);
                // Limpiamos las "A.", "B.", etc si existieran en la opción original
                label.append(` ${limpiarCitas(opcion.texto).replace(/^[A-Z]\.\s*/, '')}`);
                div.appendChild(label);
            });

            contenedorPreguntas.appendChild(div);
        });

        window.scrollTo(0, 0); // Subimos al inicio al cargar
    },

    entregarTest: function() {
        // Evaluamos sobre el testActivo (el barajado)
        const resultado = MotorTest.calcularPuntuacion(this.testActivo, this.respuestasActuales);
        const resBox = document.getElementById('resultado-box');
        resBox.classList.remove('hidden');
        resBox.innerHTML = `
            <p><strong>Nota Final:</strong> ${resultado.notaFinal} puntos</p>
            <p>Aciertos: ${resultado.aciertos} | Fallos: ${resultado.fallos} | En blanco: ${resultado.enBlanco}</p>
        `;

        this.testActivo.forEach((preg, idxPregunta) => {
            const seleccionUsuario = this.respuestasActuales[idxPregunta];

            preg.opciones.forEach((opcion, idxOpcion) => {
                const label = document.getElementById(`label_preg_${idxPregunta}_opc_${idxOpcion}`);
                const input = document.getElementById(`input_preg_${idxPregunta}_opc_${idxOpcion}`);

                input.disabled = true;

                if (opcion.correcta) {
                    label.classList.add('opcion-correcta');
                } else if (seleccionUsuario === idxOpcion) {
                    label.classList.add('opcion-incorrecta');
                }
            });
        });

        document.getElementById('btn-entregar').disabled = true;
        resBox.scrollIntoView({ behavior: 'smooth' });
    },

    volverAlMenu: function() {
        this.pintarMenu();
        window.scrollTo(0, 0);
    }
};

window.onload = async () => {
    try {
        const asignaturas = await CargadorAsignaturas.cargarManifiesto();
        AdaptadorDOM.iniciar(asignaturas);
    } catch (error) {
        mostrarErrorCarga(error.message);
    }
};
