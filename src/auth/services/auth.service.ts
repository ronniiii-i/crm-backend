import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { FrontendAdapterService } from '../frontend-adapter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantResolverService } from '../../tenant/tenant-resolver.service';
import { Role } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { addHours } from 'date-fns';
import { PermissionResolutionService } from './permission-resolution.service';
import { CacheService } from '../../cache/cache.service';
import { blacklistKey } from '../blacklist-key';

interface DecodedToken {
  exp?: number;
  [key: string]: unknown;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
    private frontendAdapter: FrontendAdapterService,
    private tenantResolver: TenantResolverService,
    private permissionResolution: PermissionResolutionService,
    private cache: CacheService,
  ) {}

  async signup(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = this.mailService.generateToken();

    // Self-registration cannot know the tenant, so find an existing account by
    // email across tenants, then fall back to the default tenant.
    const existingTenantId =
      await this.tenantResolver.resolveTenantByEmail(email);
    const tenantId =
      existingTenantId ?? (await this.tenantResolver.resolveDefaultTenant());

    if (!tenantId) {
      throw new UnauthorizedException('No active tenant is configured');
    }

    if (existingTenantId) {
      throw new UnauthorizedException('User already exists');
    }

    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
          role: Role.STAFF,
          verifyToken,
          verifyExpires: addHours(new Date(), 3),
          tenantId,
        },
      }),
    );

    await this.mailService.sendVerificationEmail(email, name, verifyToken);

    return {
      success: true,
      message: 'Registration successful! Please check your email.',
      user: { email: user.email, name: user.name },
    };
  }

  async verifyEmail(token: string) {
    const tenantId = await this.tenantResolver.resolveTenantByToken(
      'verifyToken',
      token,
    );
    if (!tenantId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findFirst({
        where: {
          verifyToken: token,
          verifyExpires: { gt: new Date() },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verifyToken: null,
          verifyExpires: null,
        },
      }),
    );

    return { success: true, message: 'Email verified successfully!' };
  }

  async requestPasswordReset(email: string) {
    const tenantId = await this.tenantResolver.resolveTenantByEmail(email);
    if (!tenantId) {
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };
    }

    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findFirst({ where: { email } }),
    );
    if (!user) {
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };
    }

    const resetToken = this.mailService.generateToken();

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetExpires: addHours(new Date(), 1),
        },
      }),
    );

    await this.mailService.sendPasswordResetEmail(email, user.name, resetToken);
    return { success: true, message: 'Password reset email sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tenantId = await this.tenantResolver.resolveTenantByToken(
      'resetToken',
      token,
    );
    if (!tenantId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findFirst({
        where: {
          resetToken: token,
          resetExpires: { gt: new Date() },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetToken: null,
          resetExpires: null,
        },
      }),
    );

    return { success: true, message: 'Password reset successful' };
  }

  generateTokenFromPayload(payload: any): string {
    return this.jwtService.sign(payload);
  }

  async findUserById(id: string) {
    const tenantId = await this.tenantResolver.resolveTenantByUserId(id);
    if (!tenantId) return null;

    return this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findUnique({
        where: { id },
        include: {
          department: { select: { id: true, name: true, type: true } },
          managedDepartment: { select: { id: true, name: true, type: true } },
        },
      }),
    );
  }

  /**
   * Load the full user row inside an already-resolved tenant. Used by
   * `/auth/verify`, which has the tenant id from the JWT and therefore skips
   * the extra cross-tenant lookup performed by {@link findUserById}.
   */
  async findUserByIdInTenant(id: string, tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findUnique({
        where: { id },
        include: {
          department: { select: { id: true, name: true, type: true } },
          managedDepartment: { select: { id: true, name: true, type: true } },
        },
      }),
    );
  }

  // async login(email: string, password: string) {
  //   const user = await this.prisma.user.findUnique({
  //     where: { email },
  //     include: {
  //       department: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //       managedDepartment: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //     },
  //   });

  //   if (!user) {
  //     throw new UnauthorizedException('Invalid Email');
  //   }

  //   const isMatch = await bcrypt.compare(password, user.password);
  //   if (!isMatch) {
  //     throw new UnauthorizedException('Invalid Password');
  //   }
  //   if (!user.isVerified) {
  //     throw new UnauthorizedException('Email not verified');
  //   }
  //   const payload = {
  //     sub: user.id,
  //     email: user.email,
  //     role: user.role,
  //     departmentId: user.department?.id || null,
  //     managedDepartmentId: user.managedDepartment?.id || null,
  //     verified: user.isVerified,
  //   };

  //   const token = this.jwtService.sign(payload);
  //

  //   return {
  //     success: true,
  //     message: 'Login successful!',
  //     user: {
  //       id: user.id,
  //       email: user.email,
  //       name: user.name,
  //       role: user.role,
  //       isVerified: user.isVerified,
  //       departments: user.department,
  //       managedDepartment: user.managedDepartment,
  //     },
  //     accessToken: token,
  //   };
  // }

  async login(email: string, password: string) {
    const tenantId = await this.tenantResolver.resolveTenantByEmail(email);
    if (!tenantId) {
      throw new UnauthorizedException('Invalid Email');
    }

    const user = await this.prisma.withTenant(tenantId, (tx) =>
      tx.user.findFirst({
        where: { email },
        include: {
          department: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          managedDepartment: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid Email');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid Password');
    }
    if (!user.isVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    // Ensure user object has the structure expected by getAccessibleModules
    const userForAcl = {
      id: user.id,
      role: user.role as 'ADMIN' | 'HOD' | 'LEAD' | 'STAFF', // Cast role to expected type
      tenantId: user.tenantId,
      departmentId: user.department?.id ?? null,
      managedDepartmentId: user.managedDepartment?.id ?? null,
      department: user.department ? { type: user.department.type } : undefined,
      managedDepartment: user.managedDepartment
        ? { type: user.managedDepartment.type }
        : undefined,
    };

    // Get accessible modules using the frontend adapter (tenant-scoped)
    const accessibleModules =
      await this.frontendAdapter.getAccessibleModules(userForAcl);

    // `Role+` indicator: true when groups/overrides widened or narrowed the
    // user's access relative to their base role.
    const roleEnhanced =
      await this.permissionResolution.hasEnhancedPermissions(userForAcl);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      departmentId: user.department?.id || null,
      managedDepartmentId: user.managedDepartment?.id || null,
      // The department *type* is needed by the hybrid ACL guards on every
      // request. Embedding it lets JwtStrategy validate the session without a
      // database round trip (see jwt.strategy.ts).
      departmentType: user.department?.type ?? null,
      managedDepartmentType: user.managedDepartment?.type ?? null,
      verified: user.isVerified,
      // Token schema version: 2 means "claims are complete enough to trust".
      // Tokens minted before this field existed fall back to a DB lookup.
      tv: 2,
    };

    const token = this.jwtService.sign(payload);

    return {
      success: true,
      message: 'Login successful!',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleEnhanced,
        isVerified: user.isVerified,
        tenantId: user.tenantId,
        department: user.department,
        managedDepartment: user.managedDepartment,
        // Include accessible modules directly in the user object
        accessibleModules: accessibleModules,
      },
      accessToken: token, // Still return accessToken in body for client-side JS storage
    };
  }

  // async logout(userId: string, token: string) {
  //   const decoded: string | object | null = this.jwtService.decode(token);

  //   if (
  //     !decoded ||
  //     typeof decoded !== 'object' ||
  //     typeof (decoded as DecodedToken).exp !== 'number'
  //   ) {
  //     throw new UnauthorizedException('Invalid token');
  //   }

  //   const expiresAt = new Date(((decoded as DecodedToken)?.exp ?? 0) * 1000);

  //   await this.prisma.blacklistedToken.create({
  //     data: {
  //       token,
  //       userId,
  //       expiresAt,
  //     },
  //   });

  //   return { success: true, message: 'Logout successful!' };
  // }

  async logout(token: string) {
    let userId: string | null = null;
    let expiresAt: Date | null = null;
    let decodedToken: DecodedToken | null = null;

    try {
      // Attempt to decode the token. This works even for expired tokens (does not verify signature or expiry).
      decodedToken = this.jwtService.decode(token);

      if (
        decodedToken &&
        typeof decodedToken === 'object' &&
        typeof decodedToken.exp === 'number'
      ) {
        userId = decodedToken.sub as string;
        expiresAt = new Date(decodedToken.exp * 1000);
      }
    } catch {
      // Proceed without blacklisting if token is malformed, but still return success for cookie clearing
    }

    if (token && userId && expiresAt) {
      const tenantId =
        typeof decodedToken?.tenantId === 'string'
          ? decodedToken.tenantId
          : 'global';
      const ttlSeconds = Math.max(
        1,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      );

      // Revocation is authoritative in the cache (Redis in production, bounded
      // in-process fallback otherwise) because that is what the guard checks on
      // every request. The database row is kept as a durable audit trail, but a
      // failure there (e.g. RLS/pooling) must never break logout.
      await this.cache
        .set(this.cache.tenantKey(blacklistKey(token), tenantId), true, ttlSeconds)
        .catch(() => undefined);

      try {
        await this.prisma.blacklistedToken.create({
          data: {
            token,
            userId,
            tenantId: typeof decodedToken?.tenantId === 'string'
              ? decodedToken.tenantId
              : null,
            expiresAt,
          },
        });
      } catch {
        // Duplicate token or RLS rejection: the cache entry above is enough to
        // invalidate the session for the current deployment.
      }
    }
    return { success: true, message: 'Logout successful!' };
  }
}

// async refreshToken(token: string) {
//   try {
//     const payload = this.jwtService.verify<{
//       sub: string;
//       email: string;
//       role: string;
//       verified: boolean;
//     }>(token);
//     const user = await this.prisma.user.findUnique({
//       where: { id: payload.sub },
//       include: {
//         department: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//         managedDepartment: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//       },
//     });

//     if (!user) {
//       throw new UnauthorizedException('User not found');
//     }

//     const newToken = this.jwtService.sign({
//       sub: user.id,
//       email: user.email,
//       role: user.role,
//       verified: user.isVerified,
//     });

//     return {
//       success: true,
//       message: 'Token refreshed successfully',
//       accessToken: newToken,
//     };
//   } catch {
//     throw new UnauthorizedException('Invalid token');
//   }
// }
