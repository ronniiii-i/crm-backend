import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return `
      <h1>My CRM's API</h1>
      <h2>Functional Routes:</h2>
      <ul>
        <li><a href="/auth/login">Login</a></li>
        <li><a href="/auth/register">Register</a></li>
      </ul>
    `;
  }
}
