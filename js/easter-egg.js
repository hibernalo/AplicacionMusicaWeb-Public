/**
 * Easter Egg Manager
 * Maneja el easter egg de la aplicación
 */
class EasterEggManager {
    constructor() {
        this.modal = null;
        this.selectedImages = [null, null, null]; // Array para las 3 selecciones
        this.correctCombination = ['U', 'L', 'R']; // Combinación correcta: boton_u, boton_l, boton_r
        this.currentButtonIndex = null;
        this.audioContext = null;
        this.openSound = null; // Audio element para el sonido de apertura
        this.successSound = null; // Audio element para el sonido de éxito
        this.init();
    }

    init() {
        // Esperar a que el DOM esté listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupEventListeners());
        } else {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        // Event listener para el logo
        const logoTrigger = document.getElementById('logoTrigger');
        if (logoTrigger) {
            logoTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openEasterEgg();
            });
        }

        // Event listeners para los botones del easter egg
        for (let i = 1; i <= 3; i++) {
            const button = document.getElementById(`easterButton${i}`);
            if (button) {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleButtonClick(i - 1, e);
                });
            }
        }

        // Event listener para cerrar el modal
        const closeBtn = document.getElementById('easterEggClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeEasterEgg();
            });
        }

        // Cerrar al hacer click fuera del modal
        this.modal = document.getElementById('easterEggModal');
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeEasterEgg();
                }
            });
        }

        // Cerrar selectores de imágenes al hacer click fuera de ellos
        // Usar delegación de eventos para las imágenes seleccionables
        document.addEventListener('click', (e) => {
            // Si se hace click en una imagen seleccionable
            if (e.target.classList.contains('easter-egg-select-image')) {
                e.stopPropagation();
                const imageCode = e.target.dataset.image; // 'U', 'R', 'N', 'L', 'D'
                this.selectImage(imageCode);
                return;
            }
            
            // Si se hace click en un botón del easter egg, manejar el click allí
            if (e.target.closest('.easter-egg-button') || e.target.closest('.easter-egg-button-placeholder')) {
                return; // Dejar que handleButtonClick maneje esto
            }
            
            // Si se hace click fuera del grupo de botones Y fuera del selector, cerrar selectores
            if (!e.target.closest('.easter-egg-button-group') && !e.target.closest('.easter-egg-image-selector')) {
                document.querySelectorAll('.easter-egg-image-selector').forEach(selector => {
                    selector.style.display = 'none';
                });
                this.currentButtonIndex = null;
            }
        });

        // Los event listeners para las imágenes se configurarán cuando se abra el modal

        // Inicializar AudioContext para sonidos generados
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('Web Audio API no está disponible:', error);
        }

        // Inicializar sonido de apertura
        this.openSound = new Audio('sounds/WW_Get_Heart.wav');
        this.openSound.volume = 0.7;

        // Inicializar sonido de éxito (combinación correcta)
        // Usar encodeURIComponent para manejar espacios y caracteres especiales en el nombre del archivo
        const audioPath = 'sounds/1-48. Wind\'s Requiem (Baton).mp3';
        this.successSound = new Audio(audioPath);
        this.successSound.volume = 0.3; // Volumen bajo (30%)
        this.successSound.preload = 'auto';
    }

    /**
     * Configura los event listeners para las imágenes seleccionables
     * Nota: Ahora usamos delegación de eventos, este método ya no es necesario
     * pero se mantiene por compatibilidad
     */
    setupImageListeners() {
        // Los listeners ahora se manejan mediante delegación de eventos
        // No necesitamos hacer nada aquí
    }

    /**
     * Abre el modal del easter egg y reproduce un sonido
     */
    openEasterEgg() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            // Reproducir sonido WAV al abrir
            if (this.openSound) {
                this.openSound.currentTime = 0; // Reiniciar el sonido
                this.openSound.play().catch(error => {
                    console.warn('Error reproduciendo sonido:', error);
                });
            }
            // Prevenir scroll del body
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Cierra el modal del easter egg
     */
    closeEasterEgg() {
        if (this.modal) {
            this.modal.style.display = 'none';
            // Restaurar scroll del body
            document.body.style.overflow = '';
            // Detener el audio de éxito si está reproduciéndose
            if (this.successSound && !this.successSound.paused) {
                this.successSound.pause();
                this.successSound.currentTime = 0;
            }
            // Resetear selecciones
            this.resetEasterEgg();
        }
    }

    /**
     * Maneja el click en uno de los 3 botones
     * @param {number} buttonIndex - Índice del botón (0, 1, 2)
     */
    handleButtonClick(buttonIndex, event) {
        // Prevenir propagación para que no se cierre inmediatamente
        if (event) {
            event.stopPropagation();
        }
        
        // Obtener el grupo contenedor del botón
        const button = document.getElementById(`easterButton${buttonIndex + 1}`);
        if (!button) return;
        
        const buttonGroup = button.closest('.easter-egg-button-group');
        if (!buttonGroup) return;
        
        const selector = buttonGroup.querySelector('.easter-egg-image-selector');
        if (!selector) return;
        
        // Verificar si el selector ya está visible para este botón
        const isSelectorVisible = selector.style.display !== 'none' && selector.style.display !== '';
        
        // Ocultar todos los selectores primero
        document.querySelectorAll('.easter-egg-image-selector').forEach(sel => {
            sel.style.display = 'none';
        });

        // Si el selector estaba oculto, mostrarlo
        if (!isSelectorVisible) {
            selector.style.display = 'block';
            this.currentButtonIndex = buttonIndex;
        } else {
            // Si ya estaba visible, ocultarlo
            this.currentButtonIndex = null;
        }
    }

    /**
     * Selecciona una imagen para el botón actual
     * @param {string} imageCode - Código de la imagen ('U', 'R', 'N', 'L', 'D')
     */
    selectImage(imageCode) {
        if (this.currentButtonIndex === null) return;

        // Guardar la selección
        this.selectedImages[this.currentButtonIndex] = imageCode;

        // Actualizar el botón con la imagen seleccionada
        const button = document.getElementById(`easterButton${this.currentButtonIndex + 1}`);
        if (button) {
            const buttonGroup = button.closest('.easter-egg-button-group');
            const placeholder = button.querySelector('.easter-egg-button-placeholder');
            const selector = buttonGroup ? buttonGroup.querySelector('.easter-egg-image-selector') : null;
            
            if (placeholder && selector) {
                // Ocultar placeholder y mostrar imagen
                placeholder.style.display = 'none';
                
                // Crear o actualizar la imagen en el botón
                let imgElement = button.querySelector('img:not(.easter-egg-select-image)');
                if (!imgElement) {
                    imgElement = document.createElement('img');
                    button.appendChild(imgElement);
                }
                
                // Obtener la URL de la imagen seleccionada
                const selectedImg = selector.querySelector(`img[data-image="${imageCode}"]`);
                if (selectedImg) {
                    imgElement.src = selectedImg.src;
                    imgElement.alt = selectedImg.alt;
                    imgElement.style.width = '100%';
                    imgElement.style.height = '100%';
                    imgElement.style.objectFit = 'contain';
                    imgElement.style.borderRadius = '8px';
                    imgElement.style.backgroundColor = 'var(--background)';
                    imgElement.style.padding = '8px';
                }
                
                // Ocultar el selector
                selector.style.display = 'none';
            }
        }

        // Verificar si la combinación es correcta
        this.checkCombination();
        
        // Resetear el índice del botón actual
        this.currentButtonIndex = null;
    }

    /**
     * Verifica si la combinación seleccionada es correcta
     */
    checkCombination() {
        // Verificar que todas las imágenes estén seleccionadas
        if (this.selectedImages.some(img => img === null)) {
            return;
        }

        // Verificar si la combinación es correcta
        const isCorrect = 
            this.selectedImages[0] === this.correctCombination[0] &&
            this.selectedImages[1] === this.correctCombination[1] &&
            this.selectedImages[2] === this.correctCombination[2];

        if (isCorrect) {
            // Combinación correcta!
            this.showSuccess();
            // Reproducir el audio de éxito (volumen bajo)
            if (this.successSound) {
                this.successSound.currentTime = 0; // Reiniciar el audio
                this.successSound.play().catch(error => {
                    console.warn('Error reproduciendo sonido de éxito:', error);
                });
            }
        }
    }

    /**
     * Muestra el mensaje de éxito
     */
    showSuccess() {
        const successElement = document.getElementById('easterEggSuccess');
        if (successElement) {
            successElement.style.display = 'flex'; // Usar flex para que se muestre correctamente con la imagen
        }

        // Ocultar los botones después de un tiempo
        setTimeout(() => {
            const buttonsContainer = document.querySelector('.easter-egg-buttons');
            if (buttonsContainer) {
                buttonsContainer.style.display = 'none';
            }
        }, 2000);
    }

    /**
     * Resetea el easter egg a su estado inicial
     */
    resetEasterEgg() {
        this.selectedImages = [null, null, null];
        this.currentButtonIndex = null;

        // Resetear todos los botones
        for (let i = 1; i <= 3; i++) {
            const button = document.getElementById(`easterButton${i}`);
            if (button) {
                const buttonGroup = button.closest('.easter-egg-button-group');
                const placeholder = button.querySelector('.easter-egg-button-placeholder');
                const selector = buttonGroup ? buttonGroup.querySelector('.easter-egg-image-selector') : null;
                const imgElement = button.querySelector('img:not(.easter-egg-select-image)');
                
                if (placeholder) placeholder.style.display = 'flex';
                if (selector) selector.style.display = 'none';
                if (imgElement) imgElement.remove();
            }
        }

        // Ocultar mensaje de éxito
        const successElement = document.getElementById('easterEggSuccess');
        if (successElement) {
            successElement.style.display = 'none';
        }

        // Mostrar botones de nuevo
        const buttonsContainer = document.querySelector('.easter-egg-buttons');
        if (buttonsContainer) {
            buttonsContainer.style.display = 'flex';
        }
    }

    /**
     * Reproduce un sonido
     * @param {string} type - Tipo de sonido ('success')
     */
    playSound(type) {
        if (type === 'success') {
            // Sonido de éxito: acorde mayor usando Web Audio API
            if (!this.audioContext) {
                // Si no hay AudioContext, intentar inicializarlo
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                } catch (error) {
                    console.warn('No se puede reproducir sonido:', error);
                    return;
                }
            }

            const frequencies = [523.25, 659.25, 783.99]; // Do, Mi, Sol (C, E, G)
            
            frequencies.forEach((freq, index) => {
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                
                osc.connect(gain);
                gain.connect(this.audioContext.destination);
                
                osc.frequency.value = freq;
                osc.type = 'sine';
                
                const startTime = this.audioContext.currentTime + (index * 0.1);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
                
                osc.start(startTime);
                osc.stop(startTime + 0.5);
            });
        }
    }
}

// Inicializar el Easter Egg Manager cuando el módulo se carga
const easterEggManager = new EasterEggManager();

export default easterEggManager;
