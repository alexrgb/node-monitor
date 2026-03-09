import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Resolve configuration
  const cfg = app.get(ConfigService);
  const port = Number(cfg.get('app.port')) || (process.env.PORT ? Number(process.env.PORT) : 3000);
  const corsOrigin = cfg.get('app.corsOrigin');

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // CORS
  if (corsOrigin !== undefined) {
    app.enableCors({ origin: corsOrigin as any });
  } else {
    app.enableCors();
  }

  // Swagger / OpenAPI setup
  const config = new DocumentBuilder()
    .setTitle('Node Monitor API')
    .setDescription('API for launching and monitoring native-like jobs and generating analytics')
    .setVersion('0.1.0')
    .addServer('/')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Nest app is running on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`OpenAPI docs available at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap Nest application', err);
  process.exit(1);
});
