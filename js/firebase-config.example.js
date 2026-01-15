// Ejemplo de configuración de Firebase
// Copia este archivo como firebase-config.js y reemplaza los valores

const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_AUTH_DOMAIN",
    projectId: "TU_PROJECT_ID",
    storageBucket: "TU_STORAGE_BUCKET",
    messagingSenderId: "TU_MESSAGING_SENDER_ID",
    appId: "TU_APP_ID"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Obtener referencias a Firestore y Storage
const db = firebase.firestore();
const storage = firebase.storage();

// Exportar para uso en otros módulos
export { db, storage };
