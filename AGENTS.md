# AGENTS

## Regeneration du MCP Bundle

### Faut-il regenerer le `.mcpb` ?
- Oui, si des fichiers inclus dans le bundle ont change: `manifest.json`, `server/**`, `package.json`, `package-lock.json`, `node_modules/**`, docs d'installation.
- Non, si vous executez seulement le serveur local (`node server/index.js`) sans reimporter de bundle dans l'hote.

### Regle pratique
- Usage local direct: redemarrer le serveur suffit.
- Usage via bundle installe dans un hote MCP: il faut regenerer puis reimporter le `.mcpb`.

## Mode operatoire (standard)

1. Installer les dependances:
   - `npm install`
2. Valider le projet:
   - `npm run check`
3. Generer le bundle:
   - `mcpb pack .`
4. Verifier l'artefact:
   - fichier attendu: `eur-lex-mcp.mcpb` (racine du repo)
5. Reimporter ce fichier dans l'hote MCP/Claude Desktop.

## Notes de conformite MCPB
- Manifest spec ciblee: `manifest_version: "0.3"`.
- Serveur MCP en `stdio` via `@modelcontextprotocol/sdk`.
- Les reponses outils doivent rester structurees et stables (`{ ok, data, error }`).

## References
- README MCPB: <https://github.com/anthropics/mcpb/blob/main/README.md>
- Spec manifest: <https://github.com/anthropics/mcpb/blob/main/MANIFEST.md>
- Exemples MCPB: <https://github.com/anthropics/mcpb/tree/main/examples>
