# Ágora

Catálogo de producción científica universitaria del **Grupo 6**, Proyecto 7 del curso Sistema Gestor de Base de Datos. Permite registrar artículos, tesis, investigadores, universidades, revistas, congresos y áreas de investigación. El catálogo muestra las publicaciones por universidad y los perfiles muestran las coautorías deducidas de los trabajos compartidos.

## Entrega

- [Informe técnico](documentacion/SGBD_TRABAJOFINALNOSQL_GRUPO6.docx)
- [Evidencias de implementación y rendimiento](documentacion/evidencias/)
- [Resultados del benchmark](documentacion/resultados-rendimiento.json)

## Arranque local

La entrega se verificó con Node.js 26.13.1 y ArangoDB 3.12.14 en Docker Desktop. La aplicación usa los módulos de Node.js incluidos en el runtime y no requiere instalar dependencias con npm.

1. Con Docker activo, crea una instancia de ArangoDB. Si ya existe un contenedor local del proyecto, inícialo y continúa con el paso 2. En PowerShell, escribe una contraseña local cuando se abra el cuadro de credenciales.

   ```powershell
   $env:ARANGO_PASSWORD = (Get-Credential -UserName root -Message 'Clave local de ArangoDB').GetNetworkCredential().Password
   $env:ARANGO_ROOT_PASSWORD = $env:ARANGO_PASSWORD
   docker run -d --name grupo6-arango -p 127.0.0.1:8529:8529 -e ARANGO_ROOT_PASSWORD -v grupo6-arango-data:/var/lib/arangodb3 arangodb:3.12.14
   Remove-Item Env:ARANGO_ROOT_PASSWORD
   ```

2. Abre [ArangoDB](http://127.0.0.1:8529), entra como `root` y crea o selecciona `produccion_cientifica`. En una base nueva, crea `investigadores`, `universidades`, `publicaciones` y `metadatos` como colecciones de documentos, y `autorias` y `afiliaciones` como colecciones de aristas.

3. Desde la raíz del repositorio, ejecuta `node server.cjs`. Si abriste otra terminal o reutilizas un contenedor, configura primero `ARANGO_PASSWORD` con la primera instrucción del paso 1. Abre [Ágora](http://127.0.0.1:3000/).

4. Para probar una base vacía, entra en **Gestión**, crea una universidad y registra dos investigadores afiliados a ella. Registra un artículo con ambos autores. Abre su ficha y luego el perfil de uno de ellos para comprobar que se muestra la coautoría.

## Rendimiento

La sección 7 del informe describe las pruebas con 1 000 y 10 000 publicaciones. Las mediciones originales están en [documentacion/resultados-rendimiento.json](documentacion/resultados-rendimiento.json).

## Estructura

- `server.cjs` sirve la interfaz y ejecuta las consultas AQL.
- `public/` contiene HTML, CSS y JavaScript separados.
- `documentacion/` contiene el informe y las evidencias de la entrega.
