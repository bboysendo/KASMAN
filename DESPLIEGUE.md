# Despliegue de Kasman

Guía completa para poner en marcha Kasman: contratos de Kaspa, Worker de Cloudflare, base de datos y operación diaria/mensual. Léela entera antes de tocar mainnet: la sección de **advertencias** está al final, pero es la más importante.

> Estado a septiembre de 2026:
> - **Juego + bote mensual (KasmanPool)**: listo para desplegar en testnet. No se ha hecho todavía ningún pago ni payout real contra un nodo.
> - **Colección NFT (50 KAS) + recompensas KASMAN on-chain**: contratos, comando de despliegue, web (pago con ficha, check-in, claim, mint, stake) y Worker (partidas gratis) terminados y probados en local. **Aún no desplegados en testnet**: el `src/lib/onchain.json` del repositorio es un ensayo (`deployed: false`) y la web muestra el NFT y las recompensas como "not live". Ver la sección 8.

---

## 1. Qué se despliega

| Pieza | Dónde vive | Para qué |
|---|---|---|
| Web (Vite + React) | Cloudflare Workers (assets estáticos) | El juego, el marketplace, el inventario |
| API (`worker/index.ts`) | Cloudflare Worker, plan **gratuito** | Login con wallet, pagos, partidas, ranking |
| Verificador (`worker/verifier.ts`) | Durable Object (SQLite) | Re-simula cada partida para evitar trampas |
| Base de datos (`worker/schema.sql`) | Cloudflare D1 | Jugadores, sesiones, pedidos, inventario, resultados |
| `KasmanPool.sil` | Kaspa L1 (una dirección por mes) | Guarda el KAS del bote mensual |
| `kasman-pool` (`contracts/tool`) | Tu ordenador | Genera direcciones del bote, paga al ganador y despliega (una vez) NFT + recompensas + token |
| `KCC20.sil`, `KasmanNFT.sil`, `KasmanRewards.sil`, `DailyMinter.sil`, `Treasury.sil` | Kaspa L1 | NFT (mint 50 KAS, stake), registro de días y recompensas, token KASMAN |
| SDK de Kaspa (`vendor/kaspa`, `kaspa-wasm` 2.0.1) | Navegador del jugador (y `scripts/broadcast.mjs`) | Construye, valora y envía las transacciones con contratos (≈11,5 MB, se descarga la primera vez que se usa) |

El dinero **nunca** pasa por Cloudflare: los jugadores pagan desde su wallet directamente a la dirección del contrato del mes. El Worker solo comprueba los pagos en la cadena. El Worker **no guarda ninguna clave**. Las recompensas KASMAN las registra y paga la cadena (contratos), no el Worker.

---

## 2. Requisitos

- **Node.js 24** y **pnpm 11** (nunca npm).
- **Rust 1.96** o superior (`cargo`), para la herramienta de contratos.
- **Git** con rutas largas activadas en Windows: `git config --global core.longpaths true` (el repositorio de Silverscript tiene nombres de archivo muy largos).
- Cuenta de **Cloudflare** (plan Workers Free es suficiente).
- Extensión **KasWare** en el navegador, para probar.
- Para testnet: KAS de prueba de un faucet de **testnet-10**.

Instalar dependencias:

```bash
pnpm install
```

La primera vez pnpm pide aprobar los scripts de `workerd` y `esbuild`; ya están aprobados en `pnpm-workspace.yaml`.

---

## 3. Claves

Hay una clave crítica: la **clave del oráculo**. Es la única que puede autorizar el pago del bote al ganador.

Para la colección NFT y el token hacen falta otras dos (se generan igual, con `kasman-pool keygen`; guarda cada una como la del oráculo):

- **Clave del Treasury**: su clave pública se graba en la colección; la privada retira el KAS de los mints (50 KAS cada uno) y de los royalties.
- **Clave de despliegue (`DEPLOY_KEY`)**: paga el despliegue y es la "admin" del minter, que solo sirve para su `init`. Después del despliegue no puede acuñar ni mover nada de los jugadores.

Compilar la herramienta:

```bash
cd contracts/tool
cargo build --release
# el binario queda en contracts/tool/target/release/kasman-pool(.exe)
```

La primera compilación tarda varios minutos (descarga rusty-kaspa y Silverscript).

Generar la clave:

```bash
kasman-pool keygen
# secret key (ORACLE_KEY / DEPLOY_KEY / TREASURY_KEY)=<clave privada en hex>
# pubkey=<clave pública en hex>
# testnet address=kaspatest:q...
# mainnet address=kaspa:q...
```

El mismo comando sirve para las tres claves: la privada se usa como `ORACLE_KEY`, `DEPLOY_KEY` o `TREASURY_KEY` según cuál sea; la dirección es a la que se le envían KAS (solo hace falta para la de despliegue).

- Guarda la clave privada **fuera del repositorio** (gestor de contraseñas, copia en papel, disco cifrado). La carpeta `.secrets/` está en `.gitignore`, pero úsala solo en testnet.
- En `.secrets/oracle-testnet.env` ya hay una clave de **testnet** generada durante el desarrollo. **Nunca la uses en mainnet.**
- Para mainnet genera una clave nueva en un ordenador de confianza.

---

## 4. Contrato del bote (KasmanPool)

Cada mes tiene su propia dirección, derivada de la clave pública del oráculo y del mes. Hay que generar la lista y publicarla con el Worker:

```bash
# testnet
kasman-pool pools <oracle-pubkey> testnet 2026-10 24 > worker/pools.json
# mainnet
kasman-pool pools <oracle-pubkey> mainnet 2026-10 24 > worker/pools.json
```

- `24` = número de meses. Cuando se acerque el último mes de la lista, vuelve a generarla y redespliega. Si falta el mes actual, la API responde `503 No pool address for <mes>`.
- La red del archivo (`testnet` o `mainnet`) decide también qué red exige la web a KasWare.
- **Si cambias la clave del oráculo, cambian todas las direcciones.** No lo hagas a mitad de mes con dinero en el bote.

No hace falta "desplegar" el contrato: una dirección P2SH existe en cuanto alguien le envía KAS.

---

## 5. Cloudflare (Worker + D1 + Durable Object)

### 5.1. Iniciar sesión

```bash
pnpm exec wrangler login
```

### 5.2. Base de datos D1

```bash
pnpm exec wrangler d1 create kasman
```

Copia el `database_id` que devuelve y pégalo en `wrangler.jsonc` (sustituye el `00000000-...`).

Crear las tablas en una base **nueva**:

```bash
pnpm exec wrangler d1 execute kasman --remote --file worker/schema.sql
```

#### Migraciones en una base que ya existe

`schema.sql` solo crea tablas que faltan; no añade columnas a tablas existentes. Si la base ya estaba desplegada, sigue este flujo antes de `wrangler deploy`:

1. Comprueba las columnas (solo lectura):

   ```bash
   pnpm exec wrangler d1 execute kasman --remote --command "PRAGMA table_info(players);"
   pnpm exec wrangler d1 execute kasman --remote --command "PRAGMA table_info(orders);"
   ```

2. Si `players` no tiene `x_handle` o `orders` no tiene `qty`, aplica `worker/migrations/0001_x_handle_qty_quests.sql` con:

   ```bash
   pnpm exec wrangler d1 execute kasman --remote --file worker/migrations/0001_x_handle_qty_quests.sql
   ```

   Si una columna ya existe, su `ALTER TABLE` falla con `duplicate column name` y D1 se detiene ahí. Comenta ese `ALTER` en el archivo y vuelve a ejecutarlo: las sentencias `IF NOT EXISTS` (índice `idx_players_x_handle`, índice `orders_month_kind`, tabla `quest_claims`) son idempotentes y se pueden ejecutar siempre.

3. Solo después, `pnpm build` y `pnpm exec wrangler deploy`. Desplegar el Worker antes de la migración rompe las partidas, compras y Quests.

Nunca ejecutes `DROP TABLE` sobre datos de producción. `schema.sql` todavía contiene `DROP TABLE IF EXISTS stakes` y `rewards`, tablas antiguas reemplazadas por los contratos; no las ejecutes contra una base con datos sin revisarlo antes.

### 5.3. Configuración (`wrangler.jsonc`)

- `KASPA_API`: API REST de la **misma red** que `worker/pools.json`.
  - testnet-10: `https://api-tn10.kaspa.org`
  - mainnet: `https://api.kaspa.org`
- El Durable Object `Verifier` se crea solo al desplegar (migración `v1`). No añadas `limits.cpu_ms`: es solo para el plan de pago.

### 5.4. Desplegar

```bash
pnpm exec tsc -b && pnpm lint && pnpm test   # todo debe pasar
pnpm build
pnpm exec wrangler deploy
```

### 5.5. Dominio propio (recomendado)

Asigna un dominio propio al Worker desde el panel de Cloudflare. Sin él, la caché de 30 s del ranking y del bote **no funciona** (la Cache API no actúa en `*.workers.dev`) y el plan gratuito se gasta más rápido.

### 5.6. Comprobar

```bash
curl https://<tu-dominio>/api/me          # {"address":null,...}
curl https://<tu-dominio>/api/pool        # dirección y KAS del bote del mes
pnpm exec wrangler tail                   # logs en vivo
```

Después, en el navegador: Connect wallet → pagar una entrada → jugar → comprobar que la partida aparece en el ranking.

Juega **una partida larga** (más de 20 minutos) y mira `wrangler tail`: si el Durable Object corta por CPU en el plan gratuito, aparecerá ahí.

---

## 6. Desarrollo local

```bash
pnpm exec wrangler d1 execute kasman --local --file worker/schema.sql
pnpm dev                                   # http://localhost:5173 (web + API + D1 local)
```

- `pnpm dev` ejecuta el Worker real (workerd) con D1 y Durable Object locales.
- La tabla `free_games` se crea volviendo a ejecutar `schema.sql` (local y `--remote`). El mismo archivo borra las tablas provisionales `stakes` y `rewards` si existen (las recompensas ya son on-chain).
- **El esquema no tiene migraciones.** `schema.sql` usa `CREATE TABLE IF NOT EXISTS`: si cambias una tabla que ya existe, hay que borrarla y recrearla (en local) o escribir un `ALTER TABLE` (en producción, sin perder datos).
- La columna `x_handle` en `players` (usuario de X único por wallet, case-insensitive) y la tabla `quest_claims` (Social Quests) son nuevas: sobre una base ya creada (local o remota) hace falta `ALTER TABLE players ADD COLUMN x_handle TEXT;` antes de volver a ejecutar `schema.sql` (que añade el índice único y crea `quest_claims`).
- La columna `qty` en `orders` (cantidad comprada; solo las pociones piden más de 1) también es nueva: sobre una base ya creada hace falta `ALTER TABLE orders ADD COLUMN qty INTEGER NOT NULL DEFAULT 1;`.
- El índice `orders_month_kind` (cuenta de partidas pagadas por mes, usado por `/api/pool` y el objetivo de 300 partidas del Leaderboard) se crea solo con `CREATE INDEX IF NOT EXISTS`: basta con volver a ejecutar `schema.sql`, sin `ALTER TABLE`.

Comprobaciones antes de cada cambio:

```bash
pnpm exec tsc -b && pnpm lint && pnpm test && pnpm build
cd contracts/tool && cargo test
```

---

## 7. Operación: pagar el bote al ganador

El pago es **manual**: tú decides cuándo. El contrato no bloquea el dinero hasta fin de mes.

1. Descarga el resultado del mes:

   ```bash
   curl https://<tu-dominio>/api/month/2026-10/settlement > settlement.json
   ```

   Contiene `winner` (dirección del nº 1), `root` (huella SHA-256 del ranking), `paidGames`/`gamesGoal` (entradas de 1 KAS pagadas este mes frente al objetivo de `GAMES_GOAL`, `src/lib/prices.ts`, hoy 300) y `rollover` (`true` si nadie jugó **o** si el mes no llegó a `gamesGoal`: el ganador es entonces la dirección del bote del mes siguiente). El objetivo de partidas es solo informativo — no bloquea nada en el contrato — pero el Leaderboard lo muestra como "LOCKED/UNLOCKED" para orientar la decisión.

2. Revisa el ranking (`/api/month/2026-10/export`) antes de pagar. Es la única oportunidad de detectar algo raro.

3. Paga:

   ```bash
   ORACLE_KEY=<clave> kasman-pool payout mainnet https://api.kaspa.org settlement.json
   ```

   En PowerShell: `$env:ORACLE_KEY="<clave>"; kasman-pool payout ...`. Cierra la terminal al terminar para no dejar la clave en el entorno.

   La herramienta firma con la clave del oráculo, gasta todas las salidas del bote de ese mes hacia el ganador, **verifica cada entrada con el motor de scripts oficial** y solo entonces envía la transacción. Lo que entre después en el mismo mes se puede pagar con otra ejecución.

   Si la API REST rechaza la transacción (la de testnet-10 no admite los campos de las transacciones versión 1), la herramienta la guarda en `payout-txs.json`. Envíala por un nodo con `node scripts/broadcast.mjs contracts/tool/payout-txs.json <testnet-10|mainnet>`.

La raíz (`root`) queda grabada on-chain dentro de la transacción de pago: cualquiera puede descargar el export y comprobar que coincide.

### 7.1. Tokens extra del bote (KASPI, MEME…)

Cada mes puede llevar tokens extra además del KAS. Se configuran en `src/lib/bonusTokens.ts`, en `BONUS_TOKENS`, con la clave `YYYY-MM` del mes:

```ts
"2026-11": [
  { symbol: "KASPI", name: "Kaspi", amount: 1000, icon: "/assets/tokens/kaspi.png" },
  { symbol: "MEME", amount: 5000000 },
],
```

- `symbol` (obligatorio), `amount` (cantidad total a repartir), `name` y `icon` (URL o ruta bajo `public/`) son opcionales. Sin icono se muestra la inicial del símbolo.
- Se reparten **íntegros** 50/30/20 entre el top 3 (sin el 10% de mantenimiento, que solo aplica al KAS). Las tarjetas PRIZE POOL y MONTHLY REWARDS lo calculan solos.
- Es solo visual: ningún contrato ni el Worker guardan estos importes. Hay que tener los tokens en el monedero del bote y pagarlos a mano, junto con el KAS, en la operación de la sección 7.
- Para publicarlo: editar el archivo, `pnpm build` y desplegar (sección 5.4). Un mes sin entrada no muestra ningún token extra.

---

## 8. Colección NFT + recompensas KASMAN (listo, sin desplegar)

### 8.1. Parámetros

| Parámetro | Valor |
|---|---|
| Token | KasMan · `KASMAN` · **7 decimales** |
| Suministro máximo | 100.000.000.000 KASMAN |
| Recompensas | **1.000 KASMAN × multiplicador** por cada día registrado on-chain (cualquier jugador, tenga NFT o no) |
| NFTs | 350; minteo externo en KaspaCom a **50 KAS** (`NFT_PRICE_KAS`) |
| Destino del mint | Contrato `Treasury` (tu clave retira cuando quiera) |
| Reventa | En el contrato (`list`/`buy`/`cancel`): 95 % al vendedor, 5 % de royalty al Treasury. Sin botones en la web todavía |
| Arte | Vacío por ahora |

Rareza por número de NFT y ventajas del NFT **stakeado** (modo LOCKED de `KasmanNFT`). Los rangos, multiplicadores y esperas están escritos en `KasmanRewards.sil` y copiados en `rarityRules` (`src/lib/covenant.ts`) y `RARITIES` (`src/lib/prices.ts`) para la web y el Worker: cambia los tres a la vez.

| Rareza | NFT # | Partidas gratis/día | Multiplicador | Retiro cada |
|---|---|---|---|---|
| Sin NFT | - | 0 (paga la entrada de 1 KAS) | 1.0x | 7 días |
| Común | 1-175 | 1 | 1.1x | 5 días |
| Raro | 176-280 | 2 | 1.3x | 3 días |
| Épico | 281-325 | 3 | 1.6x | 48 h |
| Legendario | 326-350 | 4 | 2.0x | 24 h |

### 8.2. Cómo funcionan las recompensas (todo on-chain)

Kaspa no tiene almacenamiento global: los datos de un contrato viven en UTXOs. `KasmanRewards` es **un solo contrato (un covenant ID) con una "ficha" (UTXO) por jugador**. Nadie puede falsificar fichas, porque todas llevan el mismo covenant ID. Ni el Worker ni ninguna clave tuya intervienen en el registro ni en el pago.

- **Pagar una entrada registra el día.** El pago de 1 KAS a un `KasmanPool` va en la misma transacción que la ficha. El contrato reconstruye la dirección del bote a partir del mes, así que no se puede pagar a otro sitio.
  - El primer pago crea la ficha (`open`, desde la raíz): día 1 a 1.0x.
  - Después, `play` suma el día (10 puntos) si la ficha lleva al menos 24 h sin cambiar.
  - Un segundo pago dentro de las 24 h se hace sin la ficha: vale como entrada, pero no suma día.
  - La ficha guarda 2 KAS del jugador (depósito de almacenamiento de la red); cada NFT y cada salida de KASMAN reclamada también llevan 2 KAS.
- **Check-in con NFT stakeado** (`checkIn` + `stakeUse` del NFT): suma el día al multiplicador de su rareza (11-20 puntos). Como mucho una vez cada 24 h por ficha y por NFT.
  - Con ese check-in, el Worker (`/api/free`) da las partidas gratis del día UTC según la rareza. Solo lee la transacción en la cadena: no guarda stakes ni saldos.
- **Claim** (`KasmanRewards.claim` + `DailyMinter.claim`, firmado por el jugador):
  - `DailyMinter` acuña `puntos × 100` KASMAN al dueño de la ficha y deja la ficha a 0. Nunca pasa del tope.
  - Espera mínima entre claims: 7 días, o menos con un NFT stakeado incluido en la transacción (según su rareza).
  - La transacción no puede minarse antes del DAA que declara (`tx.daa`).
- **La clave admin de `DailyMinter`** solo sirve para su `init`. Después no puede acuñar.
- "Día" = 24 h (en DAA) desde la última vez que se tocó la ficha, no un día de calendario. Si se reclama, hay que esperar 24 h para que cuente el siguiente día.
- Cada ficha cuenta un día por entrada pagada. Si alguien abre varias fichas, gana un día por cada entrada de 1 KAS que pague, y todo ese KAS va al bote.
- On-chain, "jugar" = pagar una entrada o hacer check-in. La cadena no sabe si la partida se terminó.

### 8.3. Lanzar los contratos (una vez por red)

Se hace una sola vez. Después los contratos funcionan solos: la web construye las transacciones y cada jugador las firma con KasWare.

**Antes de empezar**

- `worker/pools.json` ya generado con la clave del oráculo definitiva (sección 4). `KasmanRewards` solo acepta entradas pagadas a esos botes.
- Herramienta compilada (`cd contracts/tool && cargo build --release`) y `pnpm install` hecho (el envío usa el SDK con Node).

**Paso a paso** (testnet-10; para mainnet cambia `testnet` → `mainnet`, la API → `https://api.kaspa.org` y `testnet-10` → `mainnet`):

1. Crea la clave del **Treasury** y la de **despliegue**:

   ```bash
   contracts/tool/target/release/kasman-pool keygen   # Treasury: guarda la clave privada; apunta el pubkey
   contracts/tool/target/release/kasman-pool keygen   # despliegue: guarda la clave privada; apunta la dirección
   ```

2. Envía **unos 25 KAS** a la dirección de despliegue (en testnet, desde el faucet). Quedan 4 × 5 KAS dentro de los contratos globales (raíz de la colección, raíz de las fichas, minter y rama del token); el resto paga comisiones y vuelve como cambio. Espera a que llegue:

   ```bash
   curl https://api-tn10.kaspa.org/addresses/<dirección de despliegue>/balance
   ```

3. Genera y comprueba las transacciones de génesis. El comando usa el UTXO más grande de esa dirección y las pasa todas por el motor de scripts antes de escribirlas:

   ```bash
   cd contracts/tool
   DEPLOY_KEY=<clave de despliegue> cargo run --release -- deploy testnet https://api-tn10.kaspa.org <oracle-pubkey> <treasury-pubkey> > ../../src/lib/onchain.json
   cd ../..
   ```

   En PowerShell: `$env:DEPLOY_KEY="<clave>"; cargo run --release -- deploy testnet https://api-tn10.kaspa.org <oracle-pubkey> <treasury-pubkey> | Out-File -Encoding utf8 ../../src/lib/onchain.json`. Cierra la terminal al terminar.

   Resultado: `src/lib/onchain.json` (IDs de los contratos, plantillas, `"deployed": true`) y `contracts/tool/deploy-txs.json` (4 transacciones firmadas; está en `.gitignore`).

4. Envíalas por un nodo público. La API REST de testnet-10 no acepta transacciones con contratos, así que se usa el SDK por wRPC:

   ```bash
   node scripts/broadcast.mjs contracts/tool/deploy-txs.json testnet-10
   ```

   Envía una a una y espera a que la red acepte cada una. Si se corta, vuelve a ejecutar el mismo comando: salta las que ya están en la red.

5. Comprueba que los contratos existen: la dirección de la raíz de fichas y la del minter deben tener 5 KAS. El navegador lo hace solo al abrir **Inventory** con la wallet conectada (si no los encuentra, muestra "Rewards contract not found on chain").

6. Aplica el esquema (crea `free_games`) y despliega la web y el Worker con el nuevo `onchain.json` (sección 5):

   ```bash
   pnpm exec wrangler d1 execute kasman --remote --file worker/schema.sql
   pnpm build && pnpm exec wrangler deploy
   ```

   La web activa entonces Mint, Stake, Check-in y Claim.

7. Guarda una copia de `src/lib/onchain.json` y de las tres claves. Borra `deploy-txs.json` cuando todo esté enviado.

Notas:

- `--dry-run` hace lo mismo con una clave y un UTXO inventados: sirve para regenerar las plantillas del repositorio (`deployed: false`), no para enviar.
- Cada despliegue crea contratos nuevos (otros IDs). Hazlo **una sola vez** por red. Si lo repites, las fichas y NFT anteriores quedan en la colección vieja.
- Cambiar la clave del oráculo cambia las direcciones del bote. `KasmanRewards` solo acepta pagos a esas direcciones, así que obliga a desplegar de nuevo.
- Los parámetros (precio 50 KAS, 3.000 NFT, rarezas, 1.000 KASMAN/día, tope) quedan grabados en los contratos. Cambiarlos también obliga a desplegar de nuevo.

### 8.4. Cómo funciona una vez lanzado

Nadie tiene que hacer nada en el servidor. Cada acción es una transacción que la web construye y KasWare firma: KasWare solo firma las entradas de la wallet del jugador, que a la vez sirven como prueba de que es el dueño.

| Acción (dónde) | Qué hace en la cadena |
|---|---|
| Pagar entrada (Play) | 1 KAS al bote del mes. Si hace ≥ 24 h del último día contado, la ficha suma el día. La primera vez crea la ficha (2 KAS de depósito). |
| Mint (Staking) | 50 KAS al Treasury. La raíz de la colección entrega el siguiente número (la rareza la da el número). |
| Stake / Unstake (Staking) | El NFT pasa a LOCKED / FREE. Stakeado no se puede vender ni transferir. |
| Daily check-in (Staking) | La ficha suma el día con el multiplicador del NFT (una vez cada 24 h). Después la web pide al Worker las partidas gratis de hoy. |
| Claim (Inventory → Rewards) | `DailyMinter` acuña puntos × 100 KASMAN a la wallet y deja la ficha a 0. La espera depende del NFT stakeado. |

La web encuentra las fichas y NFT de cada jugador leyendo el historial de su dirección (API REST) y compara cada estado con la dirección real del contrato. Envía por un nodo público con el SDK (`vendor/kaspa`, se descarga la primera vez).

### 8.5. Retirar el KAS del Treasury

Los mints (50 KAS) y los royalties se acumulan en el contrato `Treasury`. Solo la clave del Treasury puede sacarlos, cuando quieras y a donde quieras:

```bash
cd contracts/tool
TREASURY_KEY=<clave> cargo run --release -- treasury testnet https://api-tn10.kaspa.org <dirección destino>
cd ../..
node scripts/broadcast.mjs contracts/tool/treasury-txs.json testnet-10
```

Dirección de retiro en testnet (wallet de recaudo del Treasury, no del Prize Pool):
`kaspatest:qrtfmlgmpa4k7el9xmuu9m477h24y24gpwxfhpg40rdxpmeuqy6ecg5q4nn33`

La herramienta junta todos los UTXOs del Treasury (30 por transacción), firma, verifica cada entrada con el motor de scripts y escribe `treasury-txs.json`. La comisión sale del importe.

Esta dirección no vive en `.dev.vars` ni en config del Worker: el Worker nunca la toca (no tiene claves ni mueve fondos), el retiro es siempre manual con `TREASURY_KEY` desde tu máquina, como el `<dirección destino>` de arriba.

### 8.6. Probar en testnet

Tu KasWare de testnet necesita unos **100 KAS**: entrada 10, depósito de la ficha 2, NFT 50 + depósito 2, depósito de cada claim 2, y comisiones de ~0,05-0,1 KAS por transacción.

- [ ] **Play → PAY 1 KAS**: KasWare pide firmar. La transacción paga el bote y crea tu ficha (día 1). **Inventory → Rewards** muestra 1.000 KASMAN por reclamar.
- [ ] **Staking → Mint**: 50 KAS al Treasury. Tu NFT aparece en **Staking → Your NFTs**.
- [ ] **Staking → Stake**: el NFT pasa a "Staked". A las 24 h, **Daily check-in** suma el día con su multiplicador y da las partidas gratis de hoy (Play las muestra).
- [ ] **Claim** (tras la espera de tu rareza): el contrato acuña los KASMAN a tu wallet. "KASMAN received" sube.
- [ ] **Unstake**: el NFT vuelve a "Not staked".

Si algo falla, el mensaje de la web o de KasWare dice el motivo. Las transacciones se ven en el explorador de testnet buscando tu dirección.

### 8.7. Qué está hecho

- Contratos en `contracts/`: `KCC20.sil` (copia exacta del ejemplo oficial), `KasmanNFT.sil` (mint, transferir, stake = `lock`/`unlock`, `stakeUse`, vender), `KasmanRewards.sil`, `DailyMinter.sil`, `Treasury.sil`.
- **Firma con KasWare.** Los contratos no piden la firma del jugador dentro de la parte del contrato. Piden que la transacción gaste un UTXO de su wallet, y KasWare firma esa parte con `signPskt` (`signInputs`, SIGHASH_ALL, que cubre toda la transacción). Es el mismo esquema que ya usan en mainnet otras dApps con covenants Silverscript. La web comprueba que KasWare no cambió nada más antes de enviar.
- 15 pruebas con el motor de scripts real (`cd contracts/tool && cargo test`), incluidos estos ataques:
  - entrada pagada de menos o a una wallet en vez de al bote
  - ficha creada con puntos de más
  - dos días en 24 h
  - ficha o NFT de otro (aunque gaste su propia wallet)
  - NFT sin stakear o falso
  - multiplicador inflado
  - claim antes de la espera o con un DAA falso
  - acuñar de más, a otra dirección o desde una ficha falsa
  - pasar el tope
  - mint sin pagar, NFT nº 3.001
  - comprar pagando de menos, dos compras con un pago
  - retirar del Treasury con otra clave
- `kasman-pool deploy` (génesis verificada con el motor, formato Safe JSON aceptado por el SDK), `kasman-pool treasury` (retiro verificado con el motor) y `scripts/broadcast.mjs` (reanudable).
- Web (`src/lib/covenant.ts`, `src/lib/chain.ts`):
  - codificación comprobada contra el compilador de Silverscript;
  - direcciones comprobadas contra el SDK;
  - cada tipo de transacción comprobado con el SDK: masa bajo el límite estándar y comisión suficiente (`worker/chain.test.ts`).
- Worker: `/api/free` (partidas gratis desde el check-in) y `/api/pay` con ficha.

### 8.8. Qué falta

1. **Primer despliegue real en testnet-10 y el recorrido de 8.6.** Nada de esto se ha enviado aún a un nodo. Es la prueba que confirma, con tu KasWare, que la firma, las comisiones y los contratos funcionan en la red real.
2. Arte y metadatos del NFT (ahora la imagen es el Kasman).
3. Reventa del NFT en la web (`list`/`buy`/`cancel` existen en el contrato, sin botones).
4. **Auditoría externa** y mainnet.

---

## 9. Probar en testnet paso a paso

El proyecto **ya viene configurado para testnet-10**: `worker/pools.json` es de testnet (clave del oráculo de prueba en `.secrets/oracle-testnet.env`) y `KASPA_API` apunta a `https://api-tn10.kaspa.org`. Los pagos de testnet son reales en la red de pruebas, pero el KAS de prueba no vale nada.

**Si `api-tn10.kaspa.org` no indexa las transacciones** (el pago llega on-chain y el balance del pool sube, pero `/api/pay` se queda reintentando para siempre porque `GET /transactions/{txId}` devuelve "not found" aunque la tx tenga confirmaciones de sobra): es un problema del indexador público, no del código. Para seguir probando el resto del flujo (partida, canvas, leaderboard) en local mientras se resuelve, crea un `.dev.vars` (no se sube al repo) con:

```
DEV_SKIP_TX_VERIFICATION=true
```

Esto hace que `verifyPayment` (`worker/index.ts`) acepte cualquier pago sin comprobarlo en cadena — **solo funciona con `wrangler dev` / `pnpm dev` local**, `.dev.vars` nunca se lee en `wrangler deploy`. No lo pongas nunca en `wrangler.jsonc` ni en las variables/secrets de un Worker desplegado: anularía la única prueba de que una entrada, vida o skin se pagó de verdad. Bórralo o ponlo en `false` en cuanto el indexador público vuelva a funcionar.

Hay dos formas de probar: **en tu ordenador** (recomendado primero; no necesitas Cloudflare) o **desplegado en Cloudflare**.

### 9.1. Preparar KasWare

1. Instala KasWare y crea una wallet **solo para pruebas** (no uses la de mainnet).
2. En KasWare, cambia la red a **Testnet 10**. Tu dirección empezará por `kaspatest:`.
3. Consigue KAS de prueba en el faucet de testnet (`https://faucet-testnet.kaspanet.io`) o pídelos en el canal `#testnet` del Discord de Kaspa. Para probar todo necesitas unos **200 KAS de prueba**: entrada 10, vidas 10, skin 50, y para el NFT y las recompensas (8.6) otros ~100, más comisiones.

### 9.2. Probar en tu ordenador

```bash
pnpm install
pnpm exec wrangler d1 execute kasman --local --file worker/schema.sql
pnpm dev
```

Abre `http://localhost:5173`. La web, la API, la base de datos y el verificador corren en local, pero **los pagos van a testnet de verdad**.

Recorrido de prueba (marca cada punto):

- [ ] **Connect wallet** (arriba a la derecha): KasWare pide firmar un mensaje. Después se ve tu dirección corta.
- [ ] **Shop → Potions**: compra 2 Ghost Shield (0,6 KAS con el selector de cantidad). KasWare pide aprobar el pago. Tras unos segundos, el inventario muestra 2.
- [ ] **Shop → Skins**: compra una skin (3 KAS) y equípala.
- [ ] **Play**: registra tu usuario de X la primera vez (una sola vez por wallet), paga una entrada (1 KAS) y juega.
- [ ] Al terminar: "Score verified and added to your monthly total." y la partida aparece en **Leaderboard**.
- [ ] **Prize Pool** muestra el KAS acumulado (puede tardar hasta un minuto).
- [ ] Comprueba el saldo del bote en la cadena:

  ```bash
  curl http://localhost:5173/api/pool
  curl https://api-tn10.kaspa.org/addresses/<dirección del bote>/balance
  ```

- [ ] **Disconnect** y vuelve a conectar: entradas, vidas y skins siguen ahí (están en el servidor, no en el navegador).

### 9.3. Probar el pago al ganador (payout)

Es la prueba más importante: **todavía no se ha hecho nunca contra un nodo real**.

1. Compila la herramienta (una vez):

   ```bash
   cd contracts/tool
   cargo build --release
   ```

2. Descarga el resultado del mes en curso (con `pnpm dev` en marcha):

   ```bash
   curl http://localhost:5173/api/month/2026-09/settlement > settlement.json
   ```

   Cambia `2026-09` por el mes actual. `winner` debe ser tu dirección `kaspatest:`.

3. Carga la clave de prueba del oráculo y paga:

   ```bash
   # bash
   export $(grep ORACLE_KEY .secrets/oracle-testnet.env)
   contracts/tool/target/release/kasman-pool payout testnet https://api-tn10.kaspa.org settlement.json
   ```

   ```powershell
   # PowerShell
   $env:ORACLE_KEY = ((Get-Content .secrets\oracle-testnet.env)[0] -split "=")[1]
   contracts\tool\target\release\kasman-pool.exe payout testnet https://api-tn10.kaspa.org settlement.json
   ```

4. La herramienta muestra el bote, las salidas y `sent: ...`. Comprueba que el KAS llegó a tu wallet de KasWare.

   Si en lugar de `sent` dice que la API REST rechazó la transacción, envía el archivo que escribió: `node scripts/broadcast.mjs contracts/tool/payout-txs.json testnet-10`.

Si falla, guarda la salida completa del comando: es justo el tipo de error que esta prueba debe encontrar (formato de transacción v1, comisión o `computeBudget`).

### 9.4. Probar desplegado en Cloudflare

Con la configuración actual, **el primer despliegue ya es de testnet**. Sigue la sección 5 tal cual (login, `d1 create`, esquema con `--remote`, `wrangler deploy`) sin cambiar `pools.json` ni `KASPA_API`. Repite el recorrido de 9.2 en tu URL de Cloudflare y juega una partida de más de 20 minutos mirando `pnpm exec wrangler tail`.

Para pasar después a mainnet, usa una **base de datos D1 nueva** (no mezcles jugadores de testnet y mainnet) y sigue la sección 10.

### 9.5. Errores frecuentes

| Mensaje | Causa | Solución |
|---|---|---|
| `Install the KasWare wallet extension to play` | No hay KasWare | Instálala y recarga |
| `Switch KasWare to kaspa testnet` | KasWare está en otra red | Cámbiala a Testnet 10 |
| `Use a testnet wallet address` | Dirección de mainnet | Igual que arriba |
| `Pay from the connected wallet` | Pagaste desde otra cuenta de KasWare | Paga con la cuenta conectada |
| `KasWare switched account` | Cambiaste de cuenta en KasWare | Vuelve a conectar |
| `Transaction not accepted yet` (la web sigue esperando) | La red aún no aceptó el pago | Espera; la web reintenta durante ~1 minuto |
| `No pool address for <mes>` | `pools.json` no cubre este mes | Regenera `pools.json` (sección 4) |
| `Run finished faster than real time` | Partida enviada demasiado rápido | Solo pasa con clientes manipulados |
| `Replay uses more bought lives than owned` | Vidas usadas sin tenerlas | Compra vidas antes de jugar |
| `Not enough KAS in your wallet: this needs about N KAS` | Faltan KAS para la operación + depósito + comisión | Añade KAS a la wallet |
| `Busy: another claim/mint is in progress, try again in a few seconds` | Otro jugador usa en ese momento la raíz o el minter | Reintenta |
| `Your next claim is not ready yet` / `Today's day is already counted` | Aún no pasó la espera o las 24 h | Espera la cuenta atrás de Inventory |
| `Pay one game entry first: it opens your rewards record` | Check-in sin ficha | Paga una entrada |
| `The wallet changed the transaction: not sent` | KasWare devolvió algo distinto de lo pedido | No se envía nada; actualiza KasWare y reintenta |
| `Rewards contract not found on chain` | `onchain.json` no corresponde a esta red o el despliegue no se envió | Revisa 8.3 |

---

## 10. Paso a mainnet (lista de comprobación)

- [ ] Clave del oráculo **nueva**, generada y guardada fuera del repositorio, con copia de seguridad.
- [ ] `worker/pools.json` regenerado con `mainnet` y la clave pública nueva.
- [ ] `KASPA_API` = `https://api.kaspa.org` en `wrangler.jsonc`.
- [ ] `DEV_SKIP_TX_VERIFICATION` no existe en `wrangler.jsonc` ni en los secrets del Worker desplegado (solo debe vivir en tu `.dev.vars` local; ver sección 9).
- [ ] Base de datos D1 de producción creada y con el esquema aplicado.
- [ ] Dominio propio asignado.
- [ ] Pruebas completas en testnet: pago de entrada, vidas, skin, partida, ranking y **un payout real**.
- [ ] Partida larga verificada sin cortes de CPU (`wrangler tail`).
- [ ] Primer mes en mainnet con importes pequeños.
- [ ] Clave **admin** de `DailyMinter` nueva (solo para su `init`).
- [ ] Contratos NFT/token: **auditados** antes de cualquier mint en mainnet.
- [ ] Clave del **Treasury** nueva; `kasman-pool deploy mainnet https://api.kaspa.org ...` con una clave de despliegue nueva; `node scripts/broadcast.mjs ... mainnet`; `src/lib/onchain.json` de mainnet desplegado con la web.

---

## 11. Advertencias

**Dinero y claves**

- **Si pierdes la clave del oráculo, el KAS del bote queda bloqueado para siempre.** Nadie puede recuperarlo. Haz copias de seguridad.
- Si alguien roba la clave del oráculo, puede pagarse el bote a sí mismo. Guárdala fuera de Cloudflare y de cualquier servidor.
- Lo mismo vale para la clave del **Treasury** (dinero del mint y royalties). La clave de despliegue (admin de `DailyMinter`) solo inicializa el minter: después no puede acuñar.
- Nunca subas `.secrets/` ni pegues claves en issues, chats o logs.

**Tecnología experimental**

- **Silverscript es experimental** y puede cambiar sin avisar. Las versiones están fijadas (Silverscript `3ed9733`, rusty-kaspa `a41a333`); no las actualices sin volver a pasar todas las pruebas.
- **KCC20 no es un estándar auditado**: su propia documentación dice que es un ejemplo. `KasmanNFT`, `KasmanRewards`, `DailyMinter` y `Treasury` son código nuevo. **Auditoría obligatoria** antes de mainnet.
- `KasmanPool` no está auditado. Empieza con importes pequeños.
- Ninguna transacción de estos contratos se ha enviado todavía a un nodo real. El formato v1 (`computeBudget`) solo se ha probado en local y con el SDK.
- El SDK de Kaspa va copiado en `vendor/kaspa` (v2.0.1). Si lo actualizas, vuelve a pasar `pnpm test` (sobre todo `worker/chain.test.ts`).
- Las salidas de contrato pesan 4 unidades de masa de almacenamiento. Por eso las fichas, NFT y salidas de KASMAN llevan 2 KAS, y las piezas globales 5 KAS. Con valores menores el claim supera el límite de masa y la red lo rechaza.

**Confianza**

- El Worker (oráculo) decide quién gana y tú firmas el pago. El contrato solo garantiza que todo el bote va a **una** dirección firmada por tu clave. Los jugadores confían en ti; publica el export y la raíz de cada mes.
- Los replays **no se guardan**: se verifican al enviar la partida y se descartan. No se puede revisar una partida después.
- La verificación impide inventar puntuaciones, pero no detecta a un bot que juegue en tiempo real.
- Las recompensas son on-chain: nadie (tampoco tú) puede acuñar KASMAN fuera de las reglas de `KasmanRewards`. Las partidas gratis del NFT sí dependen del Worker, que las da solo tras leer en la cadena un check-in de hoy con un NFT auténtico del jugador.
- La raíz de fichas, la raíz de la colección y el minter son UTXOs únicos: si dos jugadores abren ficha, compran un NFT o reclaman en el mismo instante, uno falla y debe reintentar (la web lo explica).

**Cloudflare plan gratuito**

- Worker: 10 ms de CPU por petición. No añadas trabajo pesado al Worker; la re-simulación va en el Durable Object.
- No se ha confirmado en producción que el Durable Object tenga 30 s de CPU en el plan gratuito. Compruébalo con una partida larga.
- Límites aproximados: unas 10.000 partidas verificadas al día (Durable Objects) y unas 25.000 partidas al día (escrituras D1; las partidas gratis añaden como mucho una escritura por partida). Si se superan, verificar solo las partidas del top 10.
- D1: 500 MB. Cuando pase de ~300 MB, borrar las filas de partidas de meses ya pagados.
- La caché solo funciona con dominio propio.

**Wallets y marketplaces**

- Solo se soporta **KasWare**. El inicio de sesión exige firma Schnorr.
- Los NFTs y KASMAN **no aparecerán en OpenSea** (no soporta Kaspa) ni, por ahora, en otras wallets o marketplaces: solo en la web de Kasman.
- KASMAN tiene 7 decimales, no 18: los contratos de Kaspa usan números de 64 bits.

**Datos que no se deben cambiar**

- Los identificadores de skins (`kaspa-neon`, `inferno`, ...) se guardan en D1: nunca los renombres.
- Cualquier cambio en la física del juego invalida las partidas en curso (sube `Replay.v`).
- `KasmanRewards` reconstruye las direcciones del bote con la clave pública del oráculo: cambiar la clave del oráculo exige un `KasmanRewards` nuevo (fichas nuevas).
- Los parámetros de los contratos NFT/token forman parte de sus direcciones: cambiarlos después del génesis crea una colección o un token distintos.
