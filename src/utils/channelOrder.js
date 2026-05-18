/** Match admin channel list ordering (sort_order, then id). */
export const sortChannelsByDisplayOrder = (channels) => {
  if (!Array.isArray(channels) || channels.length === 0) return [];
  return [...channels].sort((a, b) => {
    const ao = Number(a?.sort_order ?? a?.sortOrder);
    const bo = Number(b?.sort_order ?? b?.sortOrder);
    const aOrder = Number.isFinite(ao) ? ao : Number(a?.id) || 0;
    const bOrder = Number.isFinite(bo) ? bo : Number(b?.id) || 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
};
