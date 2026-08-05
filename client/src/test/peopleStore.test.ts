import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSchoolStore, api } from '../store';

beforeEach(() => {
  vi.clearAllMocks();
  useSchoolStore.setState({
    students: [],
    teachers: [],
    staff: [],
    studentTotal: 0,
    teacherTotal: 0,
    staffTotal: 0,
    settings: { school_name: 'AL RAWA English School', address: '', phone: '', email: '', website: '' },
  });
});

describe('useSchoolStore — people', () => {
  describe('fetchStudents', () => {
    it('calls GET /students and stores array result', async () => {
      const studentList = [{ id: 's1', name: 'Alice', class: 'Class 1', studentId: 'STU001' }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: studentList });

      await useSchoolStore.getState().fetchStudents();

      expect(getSpy).toHaveBeenCalledWith('/students/', { params: { limit: '2000' } });
      expect(useSchoolStore.getState().students).toEqual(studentList);
    });

    it('handles paginated response with data wrapper', async () => {
      const studentList = [{ id: 's2', name: 'Bob', class: 'Class 2', studentId: 'STU002' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: { data: studentList, total: 1 } });

      await useSchoolStore.getState().fetchStudents({ class: 'Class 2' });

      expect(api.get).toHaveBeenCalledWith('/students/', { params: { class: 'Class 2', limit: '2000' } });
      const state = useSchoolStore.getState();
      expect(state.students).toEqual(studentList);
      expect(state.studentTotal).toBe(1);
    });

    it('passes params correctly', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      await useSchoolStore.getState().fetchStudents({ class: 'Class 1', session: '2025' });

      expect(api.get).toHaveBeenCalledWith('/students/', { params: { class: 'Class 1', session: '2025', limit: '2000' } });
    });

    it('sets loading.students flag', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      const promise = useSchoolStore.getState().fetchStudents();

      expect(useSchoolStore.getState().loading.students).toBe(true);
      await promise;
      expect(useSchoolStore.getState().loading.students).toBe(false);
    });

    it('handles error gracefully', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await useSchoolStore.getState().fetchStudents();

      expect(useSchoolStore.getState().loading.students).toBe(false);
    });
  });

  describe('fetchTeachers', () => {
    it('calls GET /teachers and stores array result', async () => {
      const teacherList = [{ id: 't1', name: 'Ms. Smith' }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: teacherList });

      await useSchoolStore.getState().fetchTeachers();

      expect(getSpy).toHaveBeenCalledWith('/teachers/', { params: { limit: '2000' } });
      expect(useSchoolStore.getState().teachers).toEqual(teacherList);
    });

    it('handles paginated response', async () => {
      const teacherList = [{ id: 't2', name: 'Mr. Jones' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: { data: teacherList, total: 1 } });

      await useSchoolStore.getState().fetchTeachers({ designation: 'head' });

      expect(api.get).toHaveBeenCalledWith('/teachers/', { params: { designation: 'head', limit: '2000' } });
      expect(useSchoolStore.getState().teachers).toEqual(teacherList);
      expect(useSchoolStore.getState().teacherTotal).toBe(1);
    });

    it('sets loading.teachers flag', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      const promise = useSchoolStore.getState().fetchTeachers();

      expect(useSchoolStore.getState().loading.teachers).toBe(true);
      await promise;
      expect(useSchoolStore.getState().loading.teachers).toBe(false);
    });
  });

  describe('fetchStaff', () => {
    it('calls GET /staff and stores array result', async () => {
      const staffList = [{ id: 'st1', name: 'John' }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: staffList });

      await useSchoolStore.getState().fetchStaff();

      expect(getSpy).toHaveBeenCalledWith('/staff/', { params: { limit: '2000' } });
      expect(useSchoolStore.getState().staff).toEqual(staffList);
    });

    it('handles paginated response', async () => {
      const staffList = [{ id: 'st2', name: 'Jane' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: { data: staffList, total: 1 } });

      await useSchoolStore.getState().fetchStaff({ designation: 'cleaner' });

      expect(api.get).toHaveBeenCalledWith('/staff/', { params: { designation: 'cleaner', limit: '2000' } });
      expect(useSchoolStore.getState().staff).toEqual(staffList);
      expect(useSchoolStore.getState().staffTotal).toBe(1);
    });

    it('sets loading.staff flag', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      const promise = useSchoolStore.getState().fetchStaff();

      expect(useSchoolStore.getState().loading.staff).toBe(true);
      await promise;
      expect(useSchoolStore.getState().loading.staff).toBe(false);
    });
  });

  describe('fetchSettings', () => {
    it('calls GET /settings and stores result', async () => {
      const settings = { school_name: 'Test School', address: '123 Street', phone: '555', email: 'a@b.com', website: 'test.com' };
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: settings });

      await useSchoolStore.getState().fetchSettings();

      expect(getSpy).toHaveBeenCalledWith('/settings/');
      expect(useSchoolStore.getState().settings).toEqual(settings);
    });

    it('handles error gracefully', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await useSchoolStore.getState().fetchSettings();

      expect(useSchoolStore.getState().settings.school_name).toBe('AL RAWA English School');
    });
  });

  describe('updateSettings', () => {
    it('calls PUT /settings and updates state', async () => {
      const updated = { school_name: 'Updated School', address: '', phone: '', email: '', website: '' };
      const putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: updated });

      await useSchoolStore.getState().updateSettings({ school_name: 'Updated School' });

      expect(putSpy).toHaveBeenCalledWith('/settings/', { school_name: 'Updated School' });
      expect(useSchoolStore.getState().settings).toEqual(updated);
    });
  });

  describe('books', () => {
    it('fetchBooks calls GET /books and stores result', async () => {
      const bookList = [{ id: 'b1', name: 'Math Book' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: bookList });

      await useSchoolStore.getState().fetchBooks();

      expect(api.get).toHaveBeenCalledWith('/books/', { params: { limit: '50', offset: '0' } });
      expect(useSchoolStore.getState().books).toEqual(bookList);
    });

    it('fetchBooks handles paginated response', async () => {
      const bookList = [{ id: 'b2', name: 'Science Book' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: { data: bookList, total: 1 } });

      await useSchoolStore.getState().fetchBooks({ class: 'c1' });

      expect(useSchoolStore.getState().books).toEqual(bookList);
      expect(useSchoolStore.getState().bookTotal).toBe(1);
    });
  });

  describe('expense categories', () => {
    it('fetchExpenseCategories calls GET with type and maps names', async () => {
      const categories = [{ name: 'Rent' }, { name: 'Utilities' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: categories });

      await useSchoolStore.getState().fetchExpenseCategories();

      expect(api.get).toHaveBeenCalledWith('/categories/?type=EXPENSE');
      expect(useSchoolStore.getState().expenseCategories).toEqual(['Rent', 'Utilities']);
    });
  });
});
