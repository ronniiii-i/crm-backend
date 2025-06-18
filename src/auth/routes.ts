import { Department, Permission, ProtectedRoute } from './permission-types';

export const ALL_ROUTES: ProtectedRoute[] = [
  // CRM Modules (All Department)
  {
    id: 'dashboard',
    name: 'Dashboard',
    icon: 'LayoutDashboard',
    path: '/dashboard',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW],
      LEAD: [Permission.VIEW],
      STAFF: [Permission.VIEW],
    },
  },
  {
    id: 'user-management',
    name: 'User Management',
    icon: 'Users', // Assuming an icon for User Management
    path: '/user-management',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [],
      LEAD: [],
      STAFF: [],
    },
  },
  {
    id: 'notifications',
    name: 'Notifications',
    icon: 'Bell', // Assuming an icon for Notifications
    path: '/notifications',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW],
      LEAD: [Permission.VIEW],
      STAFF: [Permission.VIEW],
    },
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'Settings',
    path: '/settings',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [],
      LEAD: [],
      STAFF: [],
    },
  },

  // Finance Modules
  {
    id: 'invoices',
    name: 'Invoices',
    icon: 'FileText', // Assuming an icon for Invoices
    path: '/finance/invoices',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'payments',
    name: 'Payments',
    icon: 'CreditCard', // Assuming an icon for Payments
    path: '/finance/payments',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'expense-tracking',
    name: 'Expense Tracking',
    icon: 'Receipt', // Assuming an icon for Expense Tracking
    path: '/finance/expense-tracking',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'budget-management',
    name: 'Budget Management',
    icon: 'PiggyBank', // Assuming an icon for Budget Management
    path: '/finance/budget-management',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'financial-reports',
    name: 'Financial Reports',
    icon: 'BarChart2', // Assuming an icon for Financial Reports
    path: '/finance/financial-reports',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },

  // IT Modules
  {
    id: 'asset-management',
    name: 'Asset Management',
    icon: 'HardDrive', // Assuming an icon for Asset Management
    path: '/it/asset-management',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'ticketing-issue-tracking',
    name: 'Ticketing / Issue Tracking',
    icon: 'Ticket', // Assuming an icon for Ticketing / Issue Tracking
    path: '/it/ticketing-issue-tracking',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'system-monitoring',
    name: 'System Monitoring',
    icon: 'Monitor', // Assuming an icon for System Monitoring
    path: '/it/system-monitoring',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'software-licenses',
    name: 'Software Licenses',
    icon: 'Key', // Assuming an icon for Software Licenses
    path: '/it/software-licenses',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'it-support-requests',
    name: 'IT Support Requests',
    icon: 'LifeBuoy', // Assuming an icon for IT Support Requests
    path: '/it/support-requests',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },

  // Sales Modules
  {
    id: 'leads-management',
    name: 'Leads Management',
    icon: 'Users', // Assuming an icon for Leads Management
    path: '/sales/leads-management',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'opportunities-deals',
    name: 'Opportunities / Deals',
    icon: 'DollarSign', // Assuming an icon for Opportunities / Deals
    path: '/sales/opportunities-deals',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'contacts',
    name: 'Contacts',
    icon: 'Contact', // Assuming an icon for Contacts
    path: '/sales/contacts',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'sales-pipeline',
    name: 'Sales Pipeline',
    icon: 'TrendingUp', // Assuming an icon for Sales Pipeline
    path: '/sales/sales-pipeline',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'quotes-proposals',
    name: 'Quotes / Proposals',
    icon: 'FileInvoice', // Assuming an icon for Quotes / Proposals
    path: '/sales/quotes-proposals',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'sales-reports',
    name: 'Sales Reports',
    icon: 'ChartLine', // Assuming an icon for Sales Reports
    path: '/sales/sales-reports',
    department: Department.SALES,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },

  // Customer Support Modules
  {
    id: 'support-tickets',
    name: 'Support Tickets',
    icon: 'LifeBuoy', // Assuming an icon for Support Tickets
    path: '/customer-support/support-tickets',
    department: Department.CUSTOMER_SUPPORT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'knowledge-base',
    name: 'Knowledge Base',
    icon: 'BookOpen', // Assuming an icon for Knowledge Base
    path: '/customer-support/knowledge-base',
    department: Department.CUSTOMER_SUPPORT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'customer-feedback',
    name: 'Customer Feedback',
    icon: 'MessageSquare', // Assuming an icon for Customer Feedback
    path: '/customer-support/customer-feedback',
    department: Department.CUSTOMER_SUPPORT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'sla-management',
    name: 'SLA Management',
    icon: 'Award', // Assuming an icon for SLA Management
    path: '/customer-support/sla-management',
    department: Department.CUSTOMER_SUPPORT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'live-chat-communication',
    name: 'Live Chat / Communication',
    icon: 'MessageCircle', // Assuming an icon for Live Chat / Communication
    path: '/customer-support/live-chat-communication',
    department: Department.CUSTOMER_SUPPORT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },

  // Human Resources Modules
  {
    id: 'employee-records',
    name: 'Employee Records',
    icon: 'UserCog', // Assuming an icon for Employee Records
    path: '/hr/employee-records',
    department: Department.HR,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'attendance-leave-management',
    name: 'Attendance / Leave Management',
    icon: 'CalendarCheck', // Assuming an icon for Attendance / Leave Management
    path: '/hr/attendance-leave-management',
    department: Department.HR,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'recruitment-job-postings',
    name: 'Recruitment / Job Postings',
    icon: 'Briefcase', // Assuming an icon for Recruitment / Job Postings
    path: '/hr/recruitment-job-postings',
    department: Department.HR,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'performance-reviews',
    name: 'Performance Reviews',
    icon: 'ClipboardCheck', // Assuming an icon for Performance Reviews
    path: '/hr/performance-reviews',
    department: Department.HR,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'payroll',
    name: 'Payroll',
    icon: 'DollarSign', // Assuming an icon for Payroll
    path: '/hr/payroll',
    department: [Department.HR, Department.ACCOUNTING],
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },

  // Accounting Modules
  {
    id: 'general-ledger',
    name: 'General Ledger',
    icon: 'Book', // Assuming an icon for General Ledger
    path: '/accounting/general-ledger',
    department: Department.ACCOUNTING,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'accounts-payable',
    name: 'Accounts Payable',
    icon: 'FileText', // Assuming an icon for Accounts Payable
    path: '/accounting/accounts-payable',
    department: Department.ACCOUNTING,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'accounts-receivable',
    name: 'Accounts Receivable',
    icon: 'FileText', // Assuming an icon for Accounts Receivable
    path: '/accounting/accounts-receivable',
    department: Department.ACCOUNTING,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'tax-management',
    name: 'Tax Management',
    icon: 'Percent', // Assuming an icon for Tax Management
    path: '/accounting/tax-management',
    department: Department.ACCOUNTING,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'financial-statements',
    name: 'Financial Statements',
    icon: 'ClipboardList', // Assuming an icon for Financial Statements
    path: '/accounting/financial-statements',
    department: Department.ACCOUNTING,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },

  // Administration Modules
  {
    id: 'document-management',
    name: 'Document Management',
    icon: 'File', // Assuming an icon for Document Management
    path: '/administration/document-management',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'meeting-scheduler',
    name: 'Meeting Scheduler',
    icon: 'Calendar', // Assuming an icon for Meeting Scheduler
    path: '/administration/meeting-scheduler',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'company-announcements',
    name: 'Company Announcements',
    icon: 'Megaphone', // Assuming an icon for Company Announcements
    path: '/administration/company-announcements',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [Permission.VIEW],
    },
  },
  {
    id: 'compliance-policies',
    name: 'Compliance / Policies',
    icon: 'Scale', // Assuming an icon for Compliance / Policies
    path: '/administration/compliance-policies',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'vendor-management',
    name: 'Vendor Management',
    icon: 'Handshake', // Assuming an icon for Vendor Management
    path: '/administration/vendor-management',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },

  // Operations Modules
  {
    id: 'project-management',
    name: 'Project Management',
    icon: 'Clipboard', // Assuming an icon for Project Management
    path: '/operations/project-management',
    department: Department.OPERATIONS,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'inventory-management',
    name: 'Inventory Management',
    icon: 'Boxes', // Assuming an icon for Inventory Management
    path: '/operations/inventory-management',
    department: Department.OPERATIONS,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      STAFF: [Permission.VIEW, Permission.EDIT],
    },
  },
  {
    id: 'workflow-automation',
    name: 'Workflow Automation',
    icon: 'Settings2', // Assuming an icon for Workflow Automation
    path: '/operations/workflow-automation',
    department: Department.OPERATIONS,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'resource-allocation',
    name: 'Resource Allocation',
    icon: 'Users', // Assuming an icon for Resource Allocation
    path: '/operations/resource-allocation',
    department: Department.OPERATIONS,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    id: 'reporting-analytics',
    name: 'Reporting & Analytics',
    icon: 'PieChart', // Assuming an icon for Reporting & Analytics
    path: '/operations/reporting-analytics',
    department: Department.OPERATIONS,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
];
