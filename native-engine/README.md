# Module natif futur

Architecture prévue :

Windows.Graphics.Capture / Direct3D 11
→ texture GPU
→ NVENC / AMF / oneVPL
→ transport WebRTC natif
→ décodage matériel
→ rendu Direct3D

Ce dossier sert de frontière claire pour la prochaine étape. Le module n'est pas
présenté comme terminé : il nécessite Visual Studio Build Tools, le Windows SDK et
les SDK des fabricants de GPU.