(function () {
    if (!window.firebase) {
        console.error("Firebase SDK is missing.");
        return;
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(window.AppConfig.firebase);
    }

    window.AppFirebase = {
        auth: firebase.auth(),
        db: firebase.firestore(),
        storage: firebase.storage ? firebase.storage() : null
    };
})();
