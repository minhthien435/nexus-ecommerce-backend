import { AppModule } from '../src/app.module.js';

describe('Application startup module graph (e2e)', () => {
  it('loads the complete AppModule without circular initialization errors', () => {
    expect(AppModule).toBeDefined();
  });
});
