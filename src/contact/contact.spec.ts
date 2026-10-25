import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContactService } from './contact.service';
import { ContactDto } from './contact.dto';
import { contactConfirmationEmail, contactTeamEmail } from '../email/templates';

const VALID = { name: 'Ada', email: 'ada@acme.io', company: 'Acme', topic: 'sales', message: 'We need an Enterprise quote for 40 seats.' };

function make({ sendFails = false, env = { SMTP_USER: 'contact@auditbenchai.com' } as Record<string, string> } = {}) {
  const saved = { id: 'm1', createdAt: new Date('2026-10-25T09:00:00Z') };
  const prisma = { contactMessage: { create: jest.fn().mockResolvedValue(saved), update: jest.fn().mockResolvedValue(saved) } };
  const email = { send: jest.fn().mockImplementation(() => (sendFails ? Promise.reject(new Error('421')) : Promise.resolve())) };
  const service = new ContactService(prisma as never, new ConfigService(env), email as never);
  return { service, prisma, email };
}

describe('ContactDto', () => {
  const errorsFor = async (body: object) =>
    (await validate(plainToInstance(ContactDto, body))).map((e) => e.property);

  it('accepts a valid message and trims whitespace', async () => {
    const dto = plainToInstance(ContactDto, { ...VALID, name: '  Ada  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('Ada');
  });

  it('rejects a bad email, unknown topic, and too-short message', async () => {
    expect(await errorsFor({ ...VALID, email: 'nope' })).toEqual(['email']);
    expect(await errorsFor({ ...VALID, topic: 'hacking' })).toEqual(['topic']);
    expect(await errorsFor({ ...VALID, message: 'hi' })).toEqual(['message']);
    expect(await errorsFor({ ...VALID, name: '   ' })).toEqual(['name']);
  });
});

describe('ContactService', () => {
  it('saves, emails the inbox with Reply-To the visitor, confirms to the visitor, and marks it emailed', async () => {
    const { service, prisma, email } = make({ env: { SMTP_USER: 'contact@auditbenchai.com', CONTACT_INBOX: 'sales@auditbenchai.com' } });
    await expect(service.submit(VALID as ContactDto)).resolves.toEqual({ received: true });

    expect(prisma.contactMessage.create).toHaveBeenCalledWith({
      data: { name: 'Ada', email: 'ada@acme.io', company: 'Acme', topic: 'sales', message: VALID.message },
    });
    const [teamCall, confirmCall] = email.send.mock.calls;
    expect(teamCall[0]).toBe('sales@auditbenchai.com');
    expect(teamCall[1]).toBe('[Contact] Sales and Enterprise plans — Ada');
    expect(teamCall[5]).toBe('Ada <ada@acme.io>');
    expect(confirmCall[0]).toBe('ada@acme.io');
    expect(prisma.contactMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { emailedAt: expect.any(Date) } });
  });

  it('falls back to SMTP_USER as the inbox', async () => {
    const { service, email } = make();
    await service.submit(VALID as ContactDto);
    expect(email.send.mock.calls[0][0]).toBe('contact@auditbenchai.com');
  });

  it('still succeeds (message saved) when the mail server fails, and does not mark it emailed', async () => {
    const { service, prisma } = make({ sendFails: true });
    await expect(service.submit(VALID as ContactDto)).resolves.toEqual({ received: true });
    expect(prisma.contactMessage.create).toHaveBeenCalled();
    expect(prisma.contactMessage.update).not.toHaveBeenCalled();
  });

  it('drops honeypot submissions silently — nothing saved or sent', async () => {
    const { service, prisma, email } = make();
    await expect(service.submit({ ...VALID, website: 'http://spam' } as ContactDto)).resolves.toEqual({ received: true });
    expect(prisma.contactMessage.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('strips characters that could break the Reply-To header out of the name', async () => {
    const { service, email } = make();
    await service.submit({ ...VALID, name: 'Eve <evil@x.com>' } as ContactDto);
    expect(email.send.mock.calls[0][5]).toBe('Eve evil@x.com <ada@acme.io>');
  });
});

describe('contact email templates', () => {
  it('team email escapes the visitor’s text', () => {
    const msg = contactTeamEmail({ name: '<b>Ada</b>', email: 'a@x.io', company: null, topicLabel: 'Product support', message: '<script>alert(1)</script>', receivedAt: new Date() });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('confirmation never echoes the visitor’s message', () => {
    const msg = contactConfirmationEmail({ name: 'Ada', topicLabel: 'Product support', appOrigin: 'https://app.x' });
    expect(msg.html).toContain('product support');
    expect(msg.html).toContain('href="https://app.x/scan"');
  });
});
