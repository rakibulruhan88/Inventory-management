import { canAccessEndpoint } from './access-policy.js';
import {
  canOpenPage,
  expandPermissions,
  firstAccessiblePage,
  type AuthUser,
} from '@afia/contracts';
const staff: AuthUser = {
  id: 'staff',
  name: 'Staff',
  username: 'staff',
  email: null,
  role: 'STAFF',
  permissions: expandPermissions(['sales.create']),
};
describe('permission policy', () => {
  it('allows only explicitly enabled operations and their dependencies', () => {
    expect(canAccessEndpoint(staff, 'SalesController', 'create')).toBe(true);
    expect(canAccessEndpoint(staff, 'ProductsController', 'search')).toBe(true);
    expect(canAccessEndpoint(staff, 'CustomersController', 'list')).toBe(true);
    expect(canAccessEndpoint(staff, 'SalesController', 'void')).toBe(false);
    expect(canAccessEndpoint(staff, 'SettingsController', 'update')).toBe(
      false,
    );
    expect(canAccessEndpoint(staff, 'StaffController', 'list')).toBe(false);
    expect(canAccessEndpoint(staff, 'ActivityController', 'details')).toBe(
      false,
    );
    expect(canAccessEndpoint(staff, 'UnknownController', 'newAction')).toBe(
      false,
    );
  });
  it('preserves admin access and restricts legacy staff until access is assigned', () => {
    expect(
      canAccessEndpoint({ ...staff, role: 'OWNER' }, 'SalesController', 'void'),
    ).toBe(true);
    expect(
      canAccessEndpoint(
        { ...staff, permissions: undefined },
        'SalesController',
        'create',
      ),
    ).toBe(false);
  });
  it('uses an accessible landing page and separates Opening Due from payment collection', () => {
    expect(firstAccessiblePage(staff)).toBe('/sales');
    expect(canOpenPage(staff, '/sales/new')).toBe(true);
    expect(canOpenPage(staff, '/dashboard')).toBe(false);
    expect(canOpenPage(staff, '/team')).toBe(false);
    const cashier = {
      ...staff,
      permissions: expandPermissions(['payments.receive']),
    };
    expect(canOpenPage(cashier, '/cashbook/receive-payment')).toBe(true);
    expect(
      canOpenPage(cashier, '/cashbook/receive-payment/add-old-customer'),
    ).toBe(false);
  });
});
