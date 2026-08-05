import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSchoolStore, api } from '../store';

beforeEach(() => {
  vi.clearAllMocks();
  useSchoolStore.setState({
    classes: [],
    subjects: [],
    studentResultsCache: {},
    classResults: {},
    academicYears: [],
    _fetchedAt: {},
  });
});

describe('useSchoolStore — academic', () => {
  describe('fetchClasses', () => {
    it('calls GET /classes and stores result', async () => {
      const classList = [{ id: 'c1', name: 'Class 1' }, { id: 'c2', name: 'Class 2' }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: classList });

      await useSchoolStore.getState().fetchClasses();

      expect(getSpy).toHaveBeenCalledWith('/classes/');
      expect(useSchoolStore.getState().classes).toEqual(classList);
    });

    it('sets loading.classes flag', async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      const promise = useSchoolStore.getState().fetchClasses();

      expect(useSchoolStore.getState().loading.classes).toBe(true);
      await promise;
      expect(useSchoolStore.getState().loading.classes).toBe(false);
    });

    it('handles error gracefully', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await useSchoolStore.getState().fetchClasses();

      expect(useSchoolStore.getState().loading.classes).toBe(false);
    });
  });

  describe('createClass', () => {
    it('calls POST /classes then re-fetches', async () => {
      const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 'c1', name: 'New Class' } });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [{ id: 'c1', name: 'New Class' }] });

      const result = await useSchoolStore.getState().createClass('New Class');

      expect(postSpy).toHaveBeenCalledWith('/classes/', { name: 'New Class' });
      expect(getSpy).toHaveBeenCalledWith('/classes/');
      expect(result).toEqual({ id: 'c1', name: 'New Class' });
    });
  });

  describe('deleteClass', () => {
    it('calls DELETE then re-fetches classes', async () => {
      const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      await useSchoolStore.getState().deleteClass('c1');

      expect(deleteSpy).toHaveBeenCalledWith('/classes/c1/');
      expect(getSpy).toHaveBeenCalledWith('/classes/');
    });
  });

  describe('reorderClasses', () => {
    it('calls PUT /classes/reorder then re-fetches', async () => {
      const putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      await useSchoolStore.getState().reorderClasses(['c2', 'c1']);

      expect(putSpy).toHaveBeenCalledWith('/classes/reorder/', { orderedIds: ['c2', 'c1'] });
      expect(getSpy).toHaveBeenCalledWith('/classes/');
    });
  });

  describe('fetchSubjects', () => {
    it('calls GET /classes/:id/subjects and stores result', async () => {
      const subjects = [{ id: 's1', name: 'Math', fullMarks: 100, classId: 'c1', order: 1 }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: subjects });

      await useSchoolStore.getState().fetchSubjects('c1');

      expect(getSpy).toHaveBeenCalledWith('/classes/c1/subjects/');
      expect(useSchoolStore.getState().subjects).toEqual(subjects);
    });

    it('handles error gracefully', async () => {
      vi.spyOn(api, 'get').mockRejectedValue(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await useSchoolStore.getState().fetchSubjects('c1');

      expect(useSchoolStore.getState().subjects).toEqual([]);
    });
  });

  describe('createSubject', () => {
    it('calls POST then re-fetches subjects for the class', async () => {
      const newSubject = { id: 's1', name: 'Math', fullMarks: 100, classId: 'c1', order: 1 };
      const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: newSubject });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [newSubject] });

      const result = await useSchoolStore.getState().createSubject('c1', 'Math', 100);

      expect(postSpy).toHaveBeenCalledWith('/classes/c1/subjects/', { name: 'Math', fullMarks: 100 });
      expect(getSpy).toHaveBeenCalledWith('/classes/c1/subjects/');
      expect(result).toEqual(newSubject);
    });
  });

  describe('updateSubject', () => {
    it('calls PUT then re-fetches subjects for the class', async () => {
      useSchoolStore.setState({ subjects: [{ id: 's1', name: 'Math', fullMarks: 100, classId: 'c1', order: 1 }] });
      const putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      await useSchoolStore.getState().updateSubject('s1', { fullMarks: 50 });

      expect(putSpy).toHaveBeenCalledWith('/subjects/s1/', { fullMarks: 50 });
      expect(getSpy).toHaveBeenCalledWith('/classes/c1/subjects/');
    });

    it('does not re-fetch if subject not found in state', async () => {
      const putSpy = vi.spyOn(api, 'put').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get');

      await useSchoolStore.getState().updateSubject('nonexistent', { fullMarks: 50 });

      expect(putSpy).toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteSubject', () => {
    it('calls DELETE then re-fetches subjects for the class', async () => {
      useSchoolStore.setState({ subjects: [{ id: 's1', name: 'Math', fullMarks: 100, classId: 'c1', order: 1 }] });
      const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: [] });

      await useSchoolStore.getState().deleteSubject('s1');

      expect(deleteSpy).toHaveBeenCalledWith('/subjects/s1/');
      expect(getSpy).toHaveBeenCalledWith('/classes/c1/subjects/');
    });

    it('does not re-fetch if deleted subject not in state', async () => {
      const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} });
      const getSpy = vi.spyOn(api, 'get');

      await useSchoolStore.getState().deleteSubject('nonexistent');

      expect(deleteSpy).toHaveBeenCalled();
      expect(getSpy).not.toHaveBeenCalled();
    });
  });

  describe('academic years and class results', () => {
    it('fetchAcademicYears calls GET and stores result', async () => {
      const years = [{ id: 'ay1', name: '2025-2026' }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: years });

      await useSchoolStore.getState().fetchAcademicYears();

      expect(api.get).toHaveBeenCalledWith('/academic-years/');
      expect(useSchoolStore.getState().academicYears).toEqual(years);
    });

    it('fetchClassResults calls GET and stores by key', async () => {
      const results = [{ id: 'r1', studentId: 'stu1', term: '1', marks: {} }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: results });

      await useSchoolStore.getState().fetchClassResults('c1', '2025');

      expect(api.get).toHaveBeenCalledWith('/classes/c1/results/', { params: { session: '2025' } });
      expect(useSchoolStore.getState().classResults['c1-2025']).toEqual(results);
    });
  });

  describe('student results caching', () => {
    it('getStudentResults fetches and caches', async () => {
      const marks = [{ id: 'r1', studentId: 'stu1', session: '2025', term: '1', marks: { Math: 90 }, attendance: null, comment: null }];
      vi.spyOn(api, 'get').mockResolvedValue({ data: marks });

      const result = await useSchoolStore.getState().getStudentResults('stu1', '2025');

      expect(api.get).toHaveBeenCalledWith('/students/stu1/results/', { params: { session: '2025' } });
      expect(result).toEqual(marks);
      expect(useSchoolStore.getState().studentResultsCache['stu1-2025']).toBeDefined();
    });

    it('getStudentResults returns cached data within 30s', async () => {
      const marks = [{ id: 'r1', studentId: 'stu1', session: '2025', term: '1', marks: { Math: 90 }, attendance: null, comment: null }];
      const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ data: marks });
      useSchoolStore.setState({ studentResultsCache: { 'stu1-2025': { data: marks, ts: Date.now() } } });

      const result = await useSchoolStore.getState().getStudentResults('stu1', '2025');

      expect(getSpy).not.toHaveBeenCalled();
      expect(result).toEqual(marks);
    });

    it('saveStudentResult posts and invalidates cache', async () => {
      useSchoolStore.setState({ studentResultsCache: { 'stu1-2025': { data: [], ts: Date.now() } } });
      vi.spyOn(api, 'post').mockResolvedValue({ data: {} });

      await useSchoolStore.getState().saveStudentResult('stu1', '1', { Math: 90 });

      expect(api.post).toHaveBeenCalledWith('/students/stu1/results/', { term: '1', marks: { Math: 90 }, session: undefined });
      expect(useSchoolStore.getState().studentResultsCache['stu1-2025']).toBeUndefined();
    });
  });
});
