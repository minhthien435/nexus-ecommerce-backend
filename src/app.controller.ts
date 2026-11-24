import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health(@Res() response: Response) {
    const health = await this.appService.health();
    response
      .status(
        health.database === 'up'
          ? HttpStatus.OK
          : HttpStatus.SERVICE_UNAVAILABLE,
      )
      .json(health);
  }
}
