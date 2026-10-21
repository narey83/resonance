// Prefer complete full-track results over newer short previews. Never apply them to tags.
export const fullTrackJobs = (jobs) =>
  jobs
    .filter(
      (job) =>
        job.requestedSeconds == null && job.status.startsWith('completed'),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

export const independentSummary = (response) => {
  if (
    !response.contentCurrent ||
    !response.analysis ||
    response.analysis.scope?.fullTrack === false
  )
    return null;
  const { analysis } = response;
  const values = Object.values(analysis.featureAvailability || {});
  if (!values.length) return null;
  return {
    jobId: response.job.jobId,
    available: values.filter((status) => status === 'available').length,
    total: values.length,
    bpm:
      analysis.features?.beats?.status === 'available'
        ? analysis.features.beats.result.bpm_median_interval
        : null,
    key:
      analysis.features?.key?.status === 'available'
        ? analysis.features.key.result.key
        : null,
  };
};
