const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const p = new PrismaClient();
p.$connect()
  .then(() => {
    console.log('connected');
    return p.$disconnect();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.log('ERR');
    console.log(e.message);
    process.exit(1);
  });
