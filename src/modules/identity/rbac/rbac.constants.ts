export const SYSTEM_ROLE_CODES = ['BUYER', 'SELLER', 'STAFF', 'ADMIN'] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export const SYSTEM_ROLES: ReadonlyArray<{
  code: SystemRoleCode;
  name: string;
  description: string;
}> = [
  { code: 'BUYER', name: 'Buyer', description: 'Marketplace buyer' },
  { code: 'SELLER', name: 'Seller', description: 'Marketplace seller' },
  {
    code: 'STAFF',
    name: 'Support Staff',
    description: 'Customer support staff',
  },
  { code: 'ADMIN', name: 'Administrator', description: 'System administrator' },
];

export type PrivilegeSeed = {
  code: string;
  module: string;
  description: string;
  roles: readonly SystemRoleCode[];
};

const all: readonly SystemRoleCode[] = ['ADMIN', 'SELLER', 'BUYER', 'STAFF'];
const adminStaff: readonly SystemRoleCode[] = ['ADMIN', 'STAFF'];
const adminSeller: readonly SystemRoleCode[] = ['ADMIN', 'SELLER'];
const buyer: readonly SystemRoleCode[] = ['BUYER'];

export const PRIVILEGE_SEEDS: readonly PrivilegeSeed[] = [
  {
    code: 'AUTH.LOGIN',
    module: 'AUTH',
    description: 'Login to the system',
    roles: all,
  },
  {
    code: 'AUTH.LOGOUT',
    module: 'AUTH',
    description: 'Logout from the system',
    roles: all,
  },
  {
    code: 'PROFILE.VIEW',
    module: 'IDENTITY',
    description: 'View own profile',
    roles: all,
  },
  {
    code: 'PROFILE.UPDATE',
    module: 'IDENTITY',
    description: 'Update own profile',
    roles: all,
  },
  {
    code: 'PROFILE.CHANGE_PASSWORD',
    module: 'IDENTITY',
    description: 'Change own password',
    roles: all,
  },
  {
    code: 'PROFILE.RESET_PASSWORD',
    module: 'IDENTITY',
    description: 'Reset forgotten password',
    roles: all,
  },
  {
    code: 'USER.CREATE',
    module: 'IDENTITY',
    description: 'Create user account',
    roles: ['ADMIN'],
  },
  {
    code: 'USER.UPDATE',
    module: 'IDENTITY',
    description: 'Update user information or status',
    roles: adminStaff,
  },
  {
    code: 'USER.DELETE',
    module: 'IDENTITY',
    description: 'Delete user account',
    roles: ['ADMIN'],
  },
  {
    code: 'USER.VIEW',
    module: 'IDENTITY',
    description: 'View user details',
    roles: adminStaff,
  },
  {
    code: 'USER.LIST',
    module: 'IDENTITY',
    description: 'View user list',
    roles: adminStaff,
  },
  {
    code: 'USER.CHANGE_PASSWORD',
    module: 'IDENTITY',
    description: 'Change another user password',
    roles: ['ADMIN'],
  },
  {
    code: 'USER.REPUTATION.VIEW',
    module: 'REPUTATION',
    description: 'View detailed user reputation',
    roles: adminStaff,
  },
  {
    code: 'USER.REPUTATION.ADJUST',
    module: 'REPUTATION',
    description: 'Adjust user reputation',
    roles: ['ADMIN'],
  },
  {
    code: 'USER.ROLE.ASSIGN',
    module: 'IDENTITY',
    description: 'Assign a role to a user',
    roles: ['ADMIN'],
  },
  {
    code: 'USER.ROLE.REVOKE',
    module: 'IDENTITY',
    description: 'Revoke a role from a user',
    roles: ['ADMIN'],
  },
  {
    code: 'SHOP.LIST',
    module: 'IDENTITY',
    description: 'View shop list',
    roles: ['ADMIN'],
  },
  {
    code: 'SHOP.VIEW',
    module: 'IDENTITY',
    description: 'View shop details',
    roles: ['ADMIN'],
  },
  {
    code: 'SHOP.UPDATE',
    module: 'IDENTITY',
    description: 'Update shop status',
    roles: ['ADMIN'],
  },
  {
    code: 'ROLE.CREATE',
    module: 'IDENTITY',
    description: 'Create role',
    roles: ['ADMIN'],
  },
  {
    code: 'ROLE.UPDATE',
    module: 'IDENTITY',
    description: 'Update role',
    roles: ['ADMIN'],
  },
  {
    code: 'ROLE.DELETE',
    module: 'IDENTITY',
    description: 'Delete role',
    roles: ['ADMIN'],
  },
  {
    code: 'ROLE.VIEW',
    module: 'IDENTITY',
    description: 'View role details',
    roles: adminStaff,
  },
  {
    code: 'ROLE.LIST',
    module: 'IDENTITY',
    description: 'View role list',
    roles: adminStaff,
  },
  {
    code: 'PRODUCT.CREATE',
    module: 'CATALOG',
    description: 'Create product',
    roles: adminSeller,
  },
  {
    code: 'PRODUCT.UPDATE',
    module: 'CATALOG',
    description: 'Update product',
    roles: adminSeller,
  },
  {
    code: 'PRODUCT.DELETE',
    module: 'CATALOG',
    description: 'Delete product',
    roles: adminSeller,
  },
  {
    code: 'PRODUCT.VIEW',
    module: 'CATALOG',
    description: 'View product details',
    roles: all,
  },
  {
    code: 'PRODUCT.LIST',
    module: 'CATALOG',
    description: 'View product list',
    roles: all,
  },
  {
    code: 'PRODUCT.SEARCH',
    module: 'CATALOG',
    description: 'Search products',
    roles: all,
  },
  {
    code: 'CATEGORY.CREATE',
    module: 'CATALOG',
    description: 'Create category',
    roles: ['ADMIN'],
  },
  {
    code: 'CATEGORY.UPDATE',
    module: 'CATALOG',
    description: 'Update category',
    roles: ['ADMIN'],
  },
  {
    code: 'CATEGORY.DELETE',
    module: 'CATALOG',
    description: 'Delete category',
    roles: ['ADMIN'],
  },
  {
    code: 'CATEGORY.VIEW',
    module: 'CATALOG',
    description: 'View category details',
    roles: all,
  },
  {
    code: 'CATEGORY.LIST',
    module: 'CATALOG',
    description: 'View category list',
    roles: all,
  },
  {
    code: 'CART.CREATE',
    module: 'COMMERCE',
    description: 'Create shopping cart',
    roles: buyer,
  },
  {
    code: 'CART.UPDATE',
    module: 'COMMERCE',
    description: 'Update cart items',
    roles: buyer,
  },
  {
    code: 'CART.REMOVE_ITEM',
    module: 'COMMERCE',
    description: 'Remove cart item',
    roles: buyer,
  },
  {
    code: 'CART.VIEW',
    module: 'COMMERCE',
    description: 'View shopping cart',
    roles: buyer,
  },
  {
    code: 'CHECKOUT.START',
    module: 'COMMERCE',
    description: 'Start checkout',
    roles: buyer,
  },
  {
    code: 'ORDER.CREATE',
    module: 'COMMERCE',
    description: 'Create order',
    roles: buyer,
  },
  {
    code: 'ORDER.CANCEL',
    module: 'COMMERCE',
    description: 'Cancel order',
    roles: ['ADMIN', 'BUYER', 'STAFF'],
  },
  {
    code: 'ORDER.VIEW',
    module: 'COMMERCE',
    description: 'View order details',
    roles: all,
  },
  {
    code: 'ORDER.LIST',
    module: 'COMMERCE',
    description: 'View order list',
    roles: all,
  },
  {
    code: 'ORDER.REFUND',
    module: 'COMMERCE',
    description: 'Request or process refund',
    roles: adminStaff,
  },
  {
    code: 'DISPUTE.MANAGE',
    module: 'COMMERCE',
    description: 'Manage and resolve customer order disputes',
    roles: adminStaff,
  },
  {
    code: 'AUCTION.CREATE',
    module: 'AUCTION',
    description: 'Create auction',
    roles: adminSeller,
  },
  {
    code: 'AUCTION.UPDATE',
    module: 'AUCTION',
    description: 'Update auction',
    roles: adminSeller,
  },
  {
    code: 'AUCTION.CANCEL',
    module: 'AUCTION',
    description: 'Cancel auction',
    roles: adminSeller,
  },
  {
    code: 'AUCTION.ADMIN_LIST',
    module: 'AUCTION',
    description: 'List and inspect all auctions for admin monitor',
    roles: ['ADMIN'],
  },
  {
    code: 'AUCTION.ADMIN_CANCEL',
    module: 'AUCTION',
    description: 'Force-cancel auction',
    roles: ['ADMIN'],
  },
  {
    code: 'AUCTION.VIEW',
    module: 'AUCTION',
    description: 'View auction details',
    roles: all,
  },
  {
    code: 'AUCTION.LIST',
    module: 'AUCTION',
    description: 'View auction list',
    roles: all,
  },
  {
    code: 'AUCTION.BID',
    module: 'AUCTION',
    description: 'Place bid',
    roles: buyer,
  },
  {
    code: 'AUCTION.VIEW_BID_HISTORY',
    module: 'AUCTION',
    description: 'View bid history',
    roles: all,
  },
  {
    code: 'SHIPPING.QUOTE',
    module: 'SHIPPING',
    description: 'Get shipping quote',
    roles: all,
  },
  {
    code: 'SHIPPING.CREATE_SHIPMENT',
    module: 'SHIPPING',
    description: 'Create shipment',
    roles: adminStaff,
  },
  {
    code: 'SHIPPING.VIEW_SHIPMENT',
    module: 'SHIPPING',
    description: 'View shipment',
    roles: all,
  },
  {
    code: 'SHIPPING.UPDATE_STATUS',
    module: 'SHIPPING',
    description: 'Update shipment status',
    roles: adminStaff,
  },
  {
    code: 'SHIPPING.MANUAL_OVERRIDE',
    module: 'SHIPPING',
    description: 'Override shipment',
    roles: adminStaff,
  },
  {
    code: 'REPUTATION.VIEW',
    module: 'REPUTATION',
    description: 'View reputation summary',
    roles: all,
  },
  {
    code: 'REPUTATION.RATE',
    module: 'REPUTATION',
    description: 'Rate transaction partner',
    roles: ['SELLER', 'BUYER'],
  },
  {
    code: 'REPUTATION.PENALTY.VIEW',
    module: 'REPUTATION',
    description: 'View penalty history',
    roles: adminStaff,
  },
  {
    code: 'REPUTATION.PENALTY.APPLY',
    module: 'REPUTATION',
    description: 'Apply reputation penalty',
    roles: ['ADMIN'],
  },
  {
    code: 'NOTIFICATION.VIEW',
    module: 'NOTIFICATION',
    description: 'View notifications',
    roles: all,
  },
  {
    code: 'NOTIFICATION.MANAGE_PREFERENCE',
    module: 'NOTIFICATION',
    description: 'Manage notification preferences',
    roles: ['SELLER', 'BUYER'],
  },
  {
    code: 'EVENT_LOG.VIEW',
    module: 'OBSERVABILITY',
    description: 'View event log list',
    roles: adminStaff,
  },
  {
    code: 'EVENT_LOG.VIEW_DETAIL',
    module: 'OBSERVABILITY',
    description: 'View event log details',
    roles: adminStaff,
  },
  {
    code: 'AUDIT_LOG.VIEW',
    module: 'OBSERVABILITY',
    description: 'View audit logs',
    roles: ['ADMIN'],
  },
  {
    code: 'SYSTEM.CONFIG.VIEW',
    module: 'SYSTEM',
    description: 'View system configuration',
    roles: ['ADMIN'],
  },
  {
    code: 'SYSTEM.CONFIG.UPDATE',
    module: 'SYSTEM',
    description: 'Update system configuration',
    roles: ['ADMIN'],
  },
  {
    code: 'SYSTEM.HEALTH.VIEW',
    module: 'SYSTEM',
    description: 'View system health',
    roles: adminStaff,
  },
];
