import 'reflect-metadata';
import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../../identity/domain/user.entity.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { RbacService } from '../../identity/rbac/rbac.service.js';
import { AuctionService } from '../auction.service.js';
import { AuctionController } from './auction.controller.js';

describe('Auction creation HTTP access', () => {
  const sellerId = '11111111-1111-4111-8111-111111111111';
  const jwt = new JwtService({ secret: 'auction-access-test-only-secret' });
  let app: INestApplication;
  const users = { findOne: vi.fn() };
  const rbac = { hasAnyRole: vi.fn(), hasAllPermissions: vi.fn() };
  const auctions = { create: vi.fn() };
  const body = () => ({
    skuId: '22222222-2222-4222-8222-222222222222',
    startPrice: 100_000,
    reservePrice: 120_000,
    bidIncrement: 10_000,
    startsAt: new Date(Date.now() + 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_660_000).toISOString(),
  });
  const token = (
    claims: Record<string, unknown> = { sub: sellerId, tokenVersion: 1 },
  ) => jwt.sign(claims);
  const post = (authorization?: string, payload = body()) => {
    const req = request(app.getHttpServer()).post('/api/v1/auctions');
    if (authorization) req.set('Authorization', authorization);
    return req.send(payload);
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    users.findOne.mockResolvedValue({ id: sellerId, tokenVersion: 1 });
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);
    auctions.create.mockResolvedValue({ id: 'auction', sellerId });
    const module = await Test.createTestingModule({
      controllers: [AuctionController],
      providers: [
        Reflector,
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: JwtService, useValue: jwt },
        { provide: getRepositoryToken(UserEntity), useValue: users },
        { provide: RbacService, useValue: rbac },
        { provide: AuctionService, useValue: auctions },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            errorCode: 'VALIDATION_ERROR',
            message: 'Dữ liệu không hợp lệ',
            errors: errors.flatMap((error) =>
              Object.entries(error.constraints ?? {}).map(
                ([rule, message]) => ({
                  field: error.property,
                  rule,
                  message,
                }),
              ),
            ),
          }),
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });

  it.each([undefined, 'Bearer invalid-token'])(
    'rejects missing or invalid authentication: %s',
    async (authorization) => {
      expect((await post(authorization)).status).toBe(401);
      expect(auctions.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { tokenVersion: 1 },
    { sub: 'invalid-subject', tokenVersion: 1 },
    { sub: 123, tokenVersion: 1 },
    { sub: sellerId },
    { sub: sellerId, tokenVersion: '1' },
  ])('rejects invalid JWT identity claims: %j', async (claims) => {
    expect((await post(`Bearer ${token(claims)}`)).status).toBe(401);
    expect(users.findOne).not.toHaveBeenCalled();
    expect(auctions.create).not.toHaveBeenCalled();
  });

  it.each([null, { id: sellerId, tokenVersion: 2 }])(
    'rejects missing active user or revoked token: %j',
    async (user) => {
      users.findOne.mockResolvedValue(user);
      expect((await post(`Bearer ${token()}`)).status).toBe(401);
      expect(auctions.create).not.toHaveBeenCalled();
    },
  );

  it.each(['role', 'permission'])('requires seller %s', async (missing) => {
    if (missing === 'role') rbac.hasAnyRole.mockResolvedValue(false);
    else rbac.hasAllPermissions.mockResolvedValue(false);
    expect((await post(`Bearer ${token()}`)).status).toBe(403);
    expect(auctions.create).not.toHaveBeenCalled();
    expect(rbac.hasAnyRole).toHaveBeenCalledWith(sellerId, ['SELLER']);
    if (missing === 'permission')
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(sellerId, [
        'AUCTION.CREATE',
      ]);
  });

  it.each([
    { reputationScore: 100 },
    { reputation: 100 },
    { sellerId: '99999999-9999-4999-8999-999999999999' },
    { sellerId: sellerId, reputationScore: 100 },
  ])(
    'rejects spoofed body fields through ValidationPipe: %j',
    async (spoofed) => {
      const response = await post(`Bearer ${token()}`, {
        ...body(),
        ...spoofed,
      });
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('VALIDATION_ERROR');
      expect(response.body.errors).toEqual(
        expect.arrayContaining(
          Object.keys(spoofed).map((field) =>
            expect.objectContaining({ field, rule: 'whitelistValidation' }),
          ),
        ),
      );
      expect(auctions.create).not.toHaveBeenCalled();
    },
  );

  it('forwards only the authenticated seller identity on an accepted request', async () => {
    const payload = body();
    const response = await post(`Bearer ${token()}`, payload);
    expect(response.status).toBe(201);
    expect(auctions.create).toHaveBeenCalledExactlyOnceWith(payload, sellerId);
    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: sellerId,
          status: 'ACTIVE',
          deletedAt: expect.anything(),
        }),
      }),
    );
  });
});
