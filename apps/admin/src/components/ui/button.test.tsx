// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('hiện nhãn và gọi onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Duyệt</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('vùng chạm tối thiểu 44px — lớp min-h-11 luôn có mặt', () => {
    render(<Button>Duyệt</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
  });

  it('disabled thì không gọi onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Duyệt
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
