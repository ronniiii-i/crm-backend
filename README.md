# CRM Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NestJS](https://img.shields.io/badge/NestJS-10.0+-red?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)

Robust CRM backend built with NestJS, TypeScript, and PostgreSQL.

## ✨ Features

### Core Modules

- ✅ Authentication (JWT)
- ✅ User Management
- ✅ Role-based Authorization
- ✅ Email Service (Nodemailer)
- ✅ Database (Prisma + PostgreSQL)

### API Features

- RESTful endpoints
- Rate limiting
- Request validation
- Swagger documentation
- Exception filters

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm 9+ or yarn
- PostgreSQL 15+
- Redis (for rate limiting)

### Installation

```bash
git clone https://github.com/your-username/crm-backend.git
cd crm-backend
npm install
```

### Configuration

Create `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/crm?schema=public"
JWT_SECRET=your_super_secret_key
EMAIL_USER=your@email.com
EMAIL_PASSWORD=your_email_password
```

### Database Setup

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### Running the App

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📂 Project Structure

```tree
crm-backend/
├── src/
│   ├── auth/              # Authentication logic
│   ├── users/             # User management
│   ├── prisma/            # Database schema
│   ├── common/            # Filters, interceptors
│   ├── app.module.ts      # Root module
│   └── main.ts            # App entry point
├── test/                  # E2E tests
└── prisma/                # Prisma files
```

## API Documentation

Run the server and visit:  
`http://localhost:3030/api` for Swagger UI  
`http://localhost:3030/api-json` for OpenAPI spec

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
