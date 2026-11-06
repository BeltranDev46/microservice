# CuentasClaras FX Microservice (`cuentasclaras-fx-microservice`)

REST microservice built with **Node.js + Express (ESM)** that provides real-time currency conversion, ISO 4217 currency catalogs, and group per-person split quotes for the **Expenses (`Nuevo gasto / Separar cuenta`)** module of **CuentasClaras** (`PRamses`).

It consumes live reference exchange rates from the third-party **[Frankfurter API](https://frankfurter.dev/)** (European Central Bank data) from the backend with strict timeouts, caching, input validation, and structured JSON error handling without ever exposing stack traces.

---

## Architecture

```text
[ CuentasClaras Frontend (React/Vite :5173) ]
        │  HttpOnly Session Cookie (/api/fx/*)
        ▼
[ CuentasClaras Main Backend (:3001) ]  ──(src/services/fxClient.js)──┐
                                                                      │ Authorization: Bearer <API_KEY | JWT>
                                                                      ▼
                                            [ FX REST Microservice (:4001) ]
                                                      │  GET /currencies, /latest (Timeout + Cache)
                                                      ▼
                                            [ Frankfurter Third-Party API ]
                                            (https://api.frankfurter.dev/v1)
```

---

## Features & Requirements Checklist

- **7 RESTful Endpoints** using semantic HTTP verbs (`GET`, `POST`, `DELETE`), plural resource URLs (`/api/v1/...`), and proper HTTP status codes (`200`, `201`, `400`, `401`, `404`, `502`, `503`, `504`).
- **Authentication Protection**: `POST /api/v1/conversions`, `GET /api/v1/conversions`, and `DELETE /api/v1/conversions/:id` require `Authorization: Bearer <token>` (supports both `MICROSERVICE_API_KEY` and `HS256` JWTs issued via `POST /api/v1/auth/token`).
- **Main Application Integration**: Consumed by `PRamses` (`backend/src/services/fxClient.js` -> `backend/src/routes/fx.js` -> `frontend/src/components/CurrencyConverterBox.jsx` inside `ExpenseForm.jsx`).
- **Third-Party API + Error Handling**: Calls `https://api.frankfurter.dev/v1` from the backend using `AbortSignal.timeout`, handling timeouts (`504`), network/upstream errors (`502`), and unsupported currencies (`400`).
- **Strict Input Validation (`400`) & Zero Stack Traces**: Validates bodies, query strings, UUID path params, and malformed JSON payloads, returning structured `{ code, error, details }` JSON objects with no stack traces.
- **Secrets in Environment Variables**: `.env` is excluded via `.gitignore`; `.env.example` documents all required variables.

---

## Setup Steps

### Prerequisites
- **Node.js** `>= 20.0.0` and **npm** `>= 10.0.0`

### 1. Clone, Configure & Run the Microservice (`:4001`)

```bash
# 1. Clone the repository and enter the directory
git clone https://github.com/BeltranDev46/microservice.git
cd microservice

# 2. Install dependencies
npm install

# 3. Create your local .env from the template
cp .env.example .env
```
*(On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.)*

> **Note**: `.env.example` already includes working local defaults so the service starts immediately. For production, replace `MICROSERVICE_API_KEY`, `JWT_SECRET` (32+ chars), and `AUTH_CLIENT_SECRET` with strong random secrets.

Start the microservice:

```bash
# Development mode (auto-reload)
npm run dev

# Or production start
npm start
```

Verify it is running:
```bash
curl http://localhost:4001/api/v1/health
curl "http://localhost:4001/api/v1/rates?base=USD&symbols=MXN,EUR"
```

---

### 2. Connect & Run the Main Application (`MonkyMoney / CuentasClaras`)

1. Clone the main application repository and configure `backend/.env`:
   ```bash
   git clone https://github.com/BeltranDev46/MonkyMoney.git
   cd MonkyMoney/backend
   npm install
   cp .env.example .env
   ```
   Make sure `FX_SERVICE_URL` and `FX_SERVICE_API_KEY` in `MonkyMoney/backend/.env` match your microservice `.env` (they already match by default when copied from `.env.example`):
   ```env
   FX_SERVICE_URL="http://localhost:4001/api/v1"
   FX_SERVICE_API_KEY="replace_with_a_strong_service_api_key"
   ```
2. Start the main backend (`:3001`):
   ```bash
   npm run dev
   ```
3. In a new terminal, start the React frontend (`:5173`):
   ```bash
   cd MonkyMoney/frontend
   npm install
   npm run dev
   ```
4. Open `http://localhost:5173`, open any group with at least 2 friends, and use the **Conversor multimoneda en tiempo real** inside **Nuevo gasto / Separar cuenta** to convert foreign expenses to `MXN` in real time and apply them directly to the group expense.

---

## Endpoint Table

Base URL: `http://localhost:4001`

| HTTP Verb | URL | Auth Required | Request Query / Body | Status Codes | Description |
| :--- | :--- | :---: | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | No | — | `200 OK` | Service health check and metadata. |
| `POST` | `/api/v1/auth/token` | No | Body: `{ "clientId", "clientSecret" }` | `200 OK`, `400`, `401`, `503` | Validates client credentials and issues a signed `HS256` Bearer JWT (`expiresIn: 3600`). |
| `GET` | `/api/v1/currencies` | No | — | `200 OK`, `502`, `504` | Fetches supported ISO 4217 currencies from the third-party Frankfurter API (cached 10 min). |
| `GET` | `/api/v1/rates` | No | Query: `?base=USD&symbols=MXN,EUR` | `200 OK`, `400`, `502`, `504` | Validates currency codes and returns latest official exchange rates from Frankfurter API. |
| `POST` | `/api/v1/conversions` | **Yes** (`Bearer`) | Body: `{ "amount": 120, "from": "USD", "to": "MXN", "participants": 4, "concept": "Cena" }` | `201 Created`, `400`, `401`, `502`, `504` | Converts an expense amount using live third-party rates, calculates per-person share, and saves the quote. Sets `Location` header. |
| `GET` | `/api/v1/conversions` | **Yes** (`Bearer`) | Query: `?limit=10` (optional `1..50`) | `200 OK`, `400`, `401` | Lists recent conversion quotes saved for the caller (`X-User-Id`). |
| `DELETE` | `/api/v1/conversions/:id` | **Yes** (`Bearer`) | Path param: `:id` (UUID) | `200 OK`, `400`, `401`, `404` | Deletes a previously saved conversion quote by UUID. |

---

## Error Format (Validation & Upstream Handling)

All errors return a consistent JSON structure and **never include stack traces**:

```json
{
  "code": "VALIDATION_ERROR",
  "error": "El campo \"amount\" es obligatorio y debe ser un número mayor a 0 y menor o igual a 100,000,000.",
  "details": [
    {
      "field": "amount",
      "message": "El campo \"amount\" es obligatorio y debe ser un número mayor a 0 y menor o igual a 100,000,000."
    }
  ]
}
```

---

## Proof That It Works

### 1. Automated Integration Tests (`node:test`)

Runs 7 end-to-end test suites verifying `200`/`201` happy paths, `401` auth enforcement, JWT issuance, `400` validation & malformed JSON handling, `404` resource deletion, `502`/`504` third-party API failure handling, and zero stack-trace leakage:

```bash
npm test
```

### 2. HTTP / Postman Request Collections

- **VS Code REST Client / JetBrains HTTP Client**: Open [`requests.http`](./requests.http) and replace `@apiKey` / `@clientSecret` with your local `.env` values.
- **Postman**: Import [`postman_collection.json`](./postman_collection.json) into Postman and set the collection variables `apiKey` and `clientSecret`.

