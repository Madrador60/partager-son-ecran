MISE À JOUR FLUIDITÉ

Cette mise à jour ajoute :

- profil 1080p 120 FPS ;
- priorité au nombre d'images plutôt qu'à la qualité ;
- bitrate élevé sur réseau rapide ;
- adaptation automatique si le ping monte ;
- surveillance du FPS, du débit, du ping et des pertes ;
- baisse de qualité avant que la latence devienne trop forte.

IMPORTANT

Cette mise à jour améliore le moteur WebRTC existant, mais elle ne garantit pas
120 FPS ni zéro lag. Pour un vrai niveau comparable à un logiciel professionnel,
il faut encore remplacer la capture Electron par une capture Direct3D native et
un encodeur matériel NVENC / AMF / Quick Sync.