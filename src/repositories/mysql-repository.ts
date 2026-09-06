import type { OpenPositionRow, Person, PersonRecord, School } from '../types.js';
import type { Repositories } from './contracts.js';
import { fixtureRepositories } from './fixture-repository.js';
import { query } from '../db.js';

// Legacy open_pos_read.inc — the live MySQL variant. Uses CONCAT/IFNULL/NOW()
// and casts the cross-type joins (pos_number, person_id) to make the link.
type OpenPositionSqlRow = {
  pos_start: string | null;
  pos_ending: string | null;
  pos_number: number | string | null;
  pos_name: string | null;
  organization: string | null;
  account_number: string | null;
  months: number | null;
  a_months: number | null;
  full_name: string | null;
  emp_number: string | null;
  classroom_assignment: string | null;
  mailstop: string | null;
  tenure_code: string | null;
  contract_id: string | null;
  contract_end: string | null;
  tap: number | null;
  Degree: string | null;
  nbpts_expire: string | null;
};

const OPEN_POSITIONS_SQL = `
SELECT DISTINCT
  pi.pos_start,
  pi.pos_ending,
  pi.pos_number,
  pi.pos_name,
  pi.organization,
  CONCAT(
    IFNULL(pi.fund, ''), '-', IFNULL(pi.purpose, ''), '-',
    IFNULL(pi.program, ''), '-', IFNULL(pi.object, ''), '-',
    IFNULL(pi.level, ''), '-', IFNULL(pi.cost_center, '')
  ) AS account_number,
  pi.months,
  e.a_months,
  IFNULL(e.full_name, '') AS full_name,
  IFNULL(e.emp_number, '') AS emp_number,
  IFNULL(e.classroom_assignment, '') AS classroom_assignment,
  IFNULL(e.mailstop, '') AS mailstop,
  IFNULL(e.tenure_code, '') AS tenure_code,
  IFNULL(e.contract_id, '') AS contract_id,
  IFNULL(e.contract_end, '') AS contract_end,
  IFNULL(e.tap, '') AS tap,
  IFNULL(e.Degree, '') AS Degree,
  IFNULL(e.nbpts_expire, '') AS nbpts_expire
FROM position_info pi
LEFT JOIN employee_info e
  ON IFNULL(CAST(e.pos_number AS UNSIGNED), 0) = IFNULL(CAST(pi.pos_number AS UNSIGNED), 0)
LEFT JOIN cert_info c
  ON IFNULL(CAST(e.person_id AS UNSIGNED), 0) = IFNULL(CAST(c.person_id AS UNSIGNED), 0)
WHERE (
        pi.pos_ending > NOW()
        OR IFNULL(pi.pos_ending, '0000-00-00') LIKE '0000-00-00%'
      )
  AND (
        (pi.pos_number LIKE '999%' AND e.full_name > ' ')
        OR pi.pos_number < '9990000'
      )
  AND pi.organization = ?
ORDER BY pi.object, pi.pos_name;
`;

function toOpenPosition(row: OpenPositionSqlRow): OpenPositionRow {
  return {
    posStart: row.pos_start ?? '',
    posEnding: row.pos_ending ?? '',
    posNumber: String(row.pos_number ?? ''),
    posName: row.pos_name ?? '',
    organization: row.organization ?? '',
    accountNumber: row.account_number ?? '',
    monthsAvailable: row.months ?? null,
    monthsUsed: row.a_months ?? null,
    fullName: row.full_name ?? '',
    employeeNumber: row.emp_number ?? '',
    classroom: row.classroom_assignment ?? '',
    mailstop: row.mailstop ?? '',
    tenureCode: row.tenure_code ?? '',
    contractId: row.contract_id ?? '',
    contractEnd: row.contract_end ?? '',
    tap: row.tap !== null && row.tap !== undefined ? String(row.tap) : '',
    degree: row.Degree ?? '',
    nbptsExpire: row.nbpts_expire ?? ''
  };
}

async function openPositions(organization: string): Promise<OpenPositionRow[]> {
  const rows = await query<OpenPositionSqlRow>(OPEN_POSITIONS_SQL, [organization]);
  return rows.map(toOpenPosition);
}

type EmployeeRow = {
  person_id: string | number;
  emp_number: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  e_mail: string | null;
  organization: string | null;
  pos_name: string | null;
  cost_center: string | null;
  object: string | null;
  primary_flag: string | null;
  position_id: string | null;
  classroom_assignment: string | null;
  a_months: number | null;
  mailstop: string | null;
};

type SchoolRow = {
  school_no: string | null;
  school_name: string | null;
  school_level: string | null;
};

async function toPerson(row: EmployeeRow): Promise<Person> {
  const schools = await query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools');
  const orgId = String(row.organization ?? '');
  const school = schools.find((candidate) => candidate.school_name === row.organization || candidate.school_no === orgId);

  return {
    personId: String(row.person_id),
    employeeNumber: String(row.emp_number ?? ''),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    fullName: row.full_name ?? '',
    email: row.e_mail ?? '',
    organizationId: school?.school_no ?? '',
    organization: row.organization ?? '',
    positionName: row.pos_name ?? '',
    costCenter: row.cost_center ?? '',
    objectCode: row.object ?? '',
    primaryFlag: row.primary_flag ?? '',
    activeAssignment: true
  };
}

export const mysqlRepositories: Repositories = {
  people: {
    async list() {
      const rows = await query<EmployeeRow>('SELECT * FROM employee_info');
      return Promise.all(rows.map(toPerson));
    }
  },
  schools: {
    async list() {
      const rows = await query<SchoolRow>('SELECT school_no, school_name, school_level FROM schools');
      return rows
        .filter((row) => row.school_name)
        .map((row): School => ({
          id: row.school_no ?? String(row.school_name),
          schoolNumber: row.school_no ?? '',
          name: row.school_name ?? '',
          type: (row.school_level?.toLowerCase().includes('school') ? 'school' : 'department') as School['type'],
          active: true
        }));
    }
  },
  personRecords: {
    async getByPersonId(personId) {
      const [employee] = await query<EmployeeRow>('SELECT * FROM employee_info WHERE person_id = ? LIMIT 1', [personId]);
      if (!employee) return null;

      const [schools] = await Promise.all([
        query<SchoolRow>('SELECT school_no, school_name FROM schools LIMIT 1')
      ]);
      const school = schools.find((candidate) => candidate.school_name === employee.organization);

      return buildRecord(employee, school);
    }
  },
  reports: { openPositions },
  // MySQL deferred: configurable report tables land here when the prod
  // migration runs. Until then, delegate to the fixture seed so the API
  // contract holds on every data source.
  reportSections: fixtureRepositories.reportSections,
  reportDefinitions: fixtureRepositories.reportDefinitions,
  reportViews: fixtureRepositories.reportViews,
  reportViewInvites: fixtureRepositories.reportViewInvites,
  reportViewComments: fixtureRepositories.reportViewComments,
  personFavorites: fixtureRepositories.personFavorites
};

function buildRecord(employee: EmployeeRow, school: SchoolRow | undefined): PersonRecord {
  return {
    personId: String(employee.person_id),
    identity: {
      fullName: employee.full_name ?? '',
      employeeNumber: String(employee.emp_number ?? ''),
      ncUid: String(employee.person_id),
      gender: '',
      ethnicity: '',
      dateOfBirth: '',
      email: employee.e_mail ?? '',
      personalEmail: ''
    },
    contact: { address: '', city: '', state: '', zip: '', phone: '' },
    assignment: {
      organizationId: school?.school_no ?? '',
      organization: employee.organization ?? '',
      classroom: employee.classroom_assignment ?? '',
      months: employee.a_months ?? 0,
      position: employee.pos_name ?? '',
      accountCode: '',
      tapPercent: 0,
      payGrade: '',
      group: '',
      mailStop: employee.mailstop ?? '',
      schoolType: '',
      supervisor: ''
    },
    compensation: { step: '', proposedSalary: 0, fixedSupplement: 0, offScale: 0, supplement: 0, tosState: 0, tosSupplement: 0, teacherDifferential: 0 },
    contract: { hireDate: '', continuousDate: '', lastChanged: '', type: '', start: '', end: '', renewalYear: '', changeType: '', boardNumber: '' },
    licensure: { type: '', renewalYear: '', expires: '', areas: [] },
    service: { yearsOfService: 0, monthsOfService: 0, lastUpdated: '' },
    leaveBalances: []
  };
}
