import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return `
      <style>
        body { font-family: sans-serif; line-height: 1.6; color: #333; }
        h1, h2, h3 { color: #2c3e50; }
        ul { list-style-type: none; padding: 0; }
        li { margin-bottom: 5px; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
      <h1>My CRM's API</h1>
      <p>Welcome to the API for my CRM application. Here are some of the key functional routes you can interact with.</p>
      
      <h2>Authentication & User Management:</h2>
      <ul>
        <li><strong>POST</strong> <a href="/auth/register">/auth/register</a> ➡️ Create a new user account.</li>
        <li><strong>POST</strong> <a href="/auth/login">/auth/login</a> ➡️ Authenticate a user and get an access token.</li>
        <li><strong>POST</strong> <a href="/auth/logout">/auth/logout</a> ➡️ Log out the current user and invalidate the session.</li>
        <li><strong>POST</strong> <a href="/auth/verify-email">/auth/verify-email</a> ➡️ Verify a user's email address with a token.</li>
        <li><strong>POST</strong> <a href="/auth/request-password-reset">/auth/request-password-reset</a> ➡️ Request a password reset email.</li>
        <li><strong>POST</strong> <a href="/auth/reset-password">/auth/reset-password</a> ➡️ Reset the user's password using a token.</li>
        <li><strong>GET</strong> <a href="/auth/verify">/auth/verify</a> ➡️ Verify the current session token and retrieve user details.</li>
        <li><strong>POST</strong> <a href="/auth/refresh">/auth/refresh</a> ➡️ Refresh an expired access token.</li>
      </ul>

      <h2>Access Control (ACL):</h2>
      <p>Routes to manage and check user permissions.</p>
      <ul>
        <li><strong>GET</strong> <a href="/auth/acl/modules">/auth/acl/modules</a> ➡️ Get a list of accessible modules for the current user.</li>
        <li><strong>GET</strong> <a href="/auth/acl/check-permission/:moduleId/:action">/auth/acl/check-permission/:moduleId/:action</a> ➡️ Check if the current user has a specific permission for a module.</li>
      </ul>
      
      <h2>Projects Module:</h2>
      <p>These routes are protected by access control guards and require specific user roles.</p>
      <ul>
        <li><strong>GET</strong> <a href="/projects">/projects</a> ➡️ Retrieve all projects accessible to the user based on their department and role.</li>
        <li><strong>GET</strong> <a href="/projects/:id">/projects/:id</a> ➡️ Retrieve a single project by ID, if the user has access.</li>
      </ul>
      
      <h3>Key Architectural Features:</h3>
      <ul>
        <li><strong>Authentication:</strong> Uses JWTs for stateless authentication. Tokens are stored as HTTP-only cookies.</li>
        <li><strong>Authorization:</strong> Implements role-based access control (RBAC) and data filtering to ensure users only see and interact with data they are permitted to.</li>
        <li><strong>Data Filtering:</strong> The <code>DataFilterService</code> dynamically filters project data based on the user's role and departmental affiliation.</li>
      </ul>
    `;
  }
}
